"""集级「视频提示词看板」路由（进入分镜工作台**之前**的主入口）。

流程口径见 `site/content/docs/plans/episode-video-prompt-batch-plan.md`：
一整集先在集页面批量生成或批量导入（7~20 条）→ 预览校对 → 批量确认保存 → 再进工作台。

端点各自只做一件事，避免"预览即落库"：
- ``GET  /{chapter_id}``        看板：本集镜头 + 当前提示词 + 来源（只读）
- ``POST /{chapter_id}/draft``      单镜生成草稿（真 LLM；**只在草稿表落库，不写正式列**）。
  页面维护逐镜队列：一次只请求一镜，点"停止"就不再发下一镜，已完成的草稿保留、
  失败项单独重试。
- ``POST /{chapter_id}/import-parse`` 解析 + 匹配（**不落库**，返回逐条匹配状态与冲突）
- ``POST /{chapter_id}/save``   确认后批量保存（覆盖模式三选一，默认只补空白）；
  **只有它**会写正式列 ``shot_details.video_prompt``，成功后清掉被写入镜头的草稿。
  ``origin=jurilu_import`` 时强制**单数** ``script_id``（恰好一个脚本组，逐条一致），
  校验发生在**任何数据库写入之前**，见 ``_validate_jurilu_script_scope``

草稿持久化（修「整集视频提示词草稿丢失」，2026-09-19）——四个端点，全部只碰草稿表：
- ``GET    /{chapter_id}/drafts``          逐镜草稿状态（刷新/中断后恢复队列）
- ``POST   /{chapter_id}/drafts``          保存**一镜**草稿（每镜生成结束后调用，幂等 upsert）
- ``DELETE /{chapter_id}/drafts``          清草稿（默认整集，可只清指定镜头）
- ``POST   /{chapter_id}/drafts/claim``    抢占该镜「生成中」租约（同一镜防并发生成/重复付费）
- ``POST   /{chapter_id}/drafts/release``  释放租约（决定不生成时用）
"""
from __future__ import annotations

import re
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.common import ApiResponse, success_response
from app.services.studio import prompt_board as svc
from app.services import paid_outlet_guard
from app.services.studio.llm_orchestration import dry_run

router = APIRouter()

_BLOCKED = (dry_run.DryRunBlocked, dry_run.RealCallNotConfirmed)

#: 巨日禄脚本组 ID 的**写死**格式口径：只允许 ``[A-Za-z0-9_-]``，长度 1–64。
#: 逗号 / 分号 / 空格 / 方括号 / 引号 等任何其它字符一律拒绝 —— 它们正是
#: "把多个 scriptId 塞进一个字段"（``"2933350,2933351"`` / ``'["2933350"]'``）的形态。
_SCRIPT_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

#: 格式口径的中文说明（错误响应里逐字给出，前端可直接展示）
_SCRIPT_ID_RULE = "只允许 [A-Za-z0-9_-]、长度 1–64 的**单个**脚本组 ID"


def _error_envelope(*, message: str, error_code: str, extra: dict[str, Any] | None = None) -> JSONResponse:
    """400 统一信封（``ApiResponse`` + ``meta.error``，与同项目其它 400 同一姿势）。

    ``message`` 只讲"用户该怎么做"；结构化原因放 ``meta.error``。
    **不含任何凭证**：这里出现的 id 只有调用方自己传进来的脚本组 ID 与镜头位置。
    """
    error: dict[str, Any] = {"code": error_code, "message": message}
    if extra:
        error.update(extra)
    body = ApiResponse[None](code=400, message=message, data=None, meta={"error": error}).model_dump()
    return JSONResponse(status_code=400, content=body)


class BoardEntryWrite(BaseModel):
    """一条要写入镜头的提示词。

    **不接受调用方指定 source**：来源由请求级 ``origin``（流程）决定，见 `ORIGIN_TO_SOURCE`。
    ``draft_token`` 仅在 ``origin=llm_draft`` 时需要，必须是后端签发的草稿令牌。
    ``script_id`` 是这一条属于哪个巨日禄脚本组：只有 ``origin=jurilu_import`` 时参与校验
    （必须与请求级 ``script_id`` **逐条一致**），其它来源不传即可。
    """

    shot_id: str = Field(..., min_length=1)
    prompt: str = Field(..., min_length=1)
    draft_token: str = Field("", description="大模型草稿令牌（origin=llm_draft 时必填）")
    script_id: str = Field("", description="本条所属的巨日禄脚本组 ID（origin=jurilu_import 时必填且逐条一致）")


class BoardDraftRequest(BaseModel):
    """单镜草稿请求（页面逐镜调用，可真正停止）。"""

    shot_id: str = Field(..., min_length=1)
    mode: Literal["fill_empty", "overwrite_selected"] = "fill_empty"
    claim_token: str = Field(
        "",
        description=(
            "「生成中」租约令牌：页面先调 /drafts/claim 占位时把它带回来，"
            "服务端据此认出是自己的租约并直接续租；不带也可以（服务端会自己抢一次）"
        ),
    )


class BoardDraftSaveRequest(BaseModel):
    """保存**一镜**草稿的请求（每镜生成结束后立刻调用；幂等 upsert）。"""

    shot_id: str = Field(..., min_length=1)
    status: Literal["ok", "failed"] = Field(
        "ok", description="ok=生成成功有正文；failed=生成失败（只记原因，正文可省略）"
    )
    prompt: str = Field("", description="草稿正文（status=ok 时必填）")
    error: str = Field("", description="失败原因（status=failed 时填）")
    source: str = Field("", description="草稿来源，省略按 llm；只接受看板允许的来源")
    model: str = Field("", description="本次使用的模型名（可选，便于对账）")
    meta: dict[str, Any] = Field(default_factory=dict, description="附加信息（latency_ms / warnings 等）")
    claim_token: str = Field("", description="本次生成持有的租约令牌（可选；写入即释放租约）")


class BoardDraftClaimRequest(BaseModel):
    """抢占一镜「生成中」租约的请求。"""

    shot_id: str = Field(..., min_length=1)
    lease_seconds: int | None = Field(
        None, description="租约时长（秒）；省略用默认值，服务端会夹到安全区间"
    )
    claim_token: str = Field("", description="同一令牌再次调用 = 续租")


class BoardDraftReleaseRequest(BaseModel):
    """释放一镜租约的请求（用户点"停止"后不生成这一镜时用）。"""

    shot_id: str = Field(..., min_length=1)
    claim_token: str = Field("", description="持有者令牌；不匹配则拒绝释放")
    error: str = Field("", description="填了就顺带把该镜记为失败（带这个原因）")


class BoardImportParseRequest(BaseModel):
    """批量导入解析请求（不落库）。"""

    text: str = Field("", description="粘贴的整段提示词文本；上传文件时前端读成文本后同样走这里")


class BoardSaveRequest(BaseModel):
    """确认后批量保存请求。"""

    entries: list[BoardEntryWrite] = Field(default_factory=list)
    mode: Literal["fill_empty", "overwrite_selected"] = "fill_empty"
    origin: Literal["llm_draft", "jurilu_import", "external_import", "manual"] = Field(
        ...,
        description="本批内容的**流程来源**（由流程决定，服务端映射成真实 source）",
    )
    selected_shot_ids: list[str] = Field(
        default_factory=list,
        description="「只覆盖选中镜头」模式下的选中集合；空表示当前集内全选",
    )
    allow_partial: bool = Field(
        False,
        description=(
            "是否允许「仅保存已匹配项」。默认 false = 提交条数与本集镜头数不一致时拒绝整体保存；"
            "用户在预览页显式切换为「仅保存已匹配项」后前端才传 true。"
        ),
    )
    script_id: str = Field("", description="巨日禄脚本组 ID（**单数**；origin=jurilu_import 时必填）")
    script_ids: Any = Field(None, description="已废弃的复数写法：传它一律 400，请改用单数 script_id")


def _validate_jurilu_script_scope(body: BoardSaveRequest) -> JSONResponse | None:
    """``/save`` 的**前置**校验：巨日禄导入必须"恰好一个脚本组"，否则整批 400。

    为什么必须在路由里做（而不是只靠 ``/jurilu-import/{pid}/apply``）：
    页面最终保存走的就是这个端点，它会**先**于任何服务层逻辑被执行；把闸门放在这里，
    才不存在"某个保存入口没有被校验"的缺口。函数是纯函数（不碰 db、不调 svc），可直接单测。

    规则（写死口径）：
    1. ``script_ids``（复数，已废弃）只要不是 ``None`` → 400，**所有 origin 都拒绝**。
       为什么连非巨日禄来源也拒：静默忽略会让前端以为"后端已经按恰好一组校验过了"，
       正是这次要堵的那个错觉。
    2. ``origin=jurilu_import`` 时继续校验：
       - 请求级 ``script_id`` 去空白后为空 → 400（缺脚本组 ID 时服务端无法保证不跨组混写）；
       - 格式不合法 / 像多个 → 400（``_SCRIPT_ID_PATTERN`` 之外的一律拒）；
       - ``entries`` **每一条**的 ``script_id`` 都必须等于请求级 ``script_id``：
         为空 → 400；不一致 → 400 并在 message 里写清是第几条与两边的 id。
    3. 其它 origin（llm_draft / external_import / manual）**一律不受影响**，不传 ``script_id`` 照常保存。

    返回 ``None`` 表示通过；返回 ``JSONResponse`` 即 400（调用方直接 return，不写库）。
    """
    # ① 复数写法：明确拒绝，不静默忽略（避免"以为后端校验过了"）
    if body.script_ids is not None:
        return _error_envelope(
            error_code="script_ids_deprecated",
            message=(
                "请求体里的 script_ids（复数）已废弃：请改用**单数** script_id；"
                "服务端按「恰好一个脚本组」校验，复数写法一律拒绝（本次未写入任何数据）。"
            ),
            extra={"deprecated_field": "script_ids", "use_instead": "script_id"},
        )

    # ② 只有巨日禄导入这条路强制脚本组范围；其它来源照旧
    if body.origin != "jurilu_import":
        return None

    script_id = str(body.script_id or "").strip()
    if not script_id:
        return _error_envelope(
            error_code="missing_script_id",
            message=(
                "巨日禄导入必须带 script_id（单数）：缺少脚本组 ID 时服务端无法保证不跨组混写；"
                "本次未写入任何数据。"
            ),
        )
    if not _SCRIPT_ID_PATTERN.match(script_id):
        seen = script_id if len(script_id) <= 80 else f"{script_id[:80]}…（共 {len(script_id)} 字符）"
        return _error_envelope(
            error_code="invalid_script_id",
            message=(
                f"script_id 格式不合法：{_SCRIPT_ID_RULE}；"
                "看起来像多个脚本组（含逗号/分号/空格/括号/引号等）时请先选定一个组再保存。"
                "本次未写入任何数据。"
            ),
            extra={"received_script_id": seen, "rule": _SCRIPT_ID_RULE},
        )

    for position, entry in enumerate(body.entries or [], start=1):
        entry_script_id = str(getattr(entry, "script_id", "") or "").strip()
        if entry_script_id == script_id:
            continue
        if not entry_script_id:
            problem = {
                "code": "entry_missing_script_id",
                "message": (
                    f"第 {position} 条缺 script_id：无法证明这一条属于所选的脚本组 {script_id}；"
                    "本次未写入任何数据。"
                ),
                "extra": {"position": position, "script_id": script_id},
            }
        else:
            problem = {
                "code": "entry_script_mismatch",
                "message": (
                    f"第 {position} 条属于脚本组 {entry_script_id}，与本次请求的脚本组 {script_id} 不一致："
                    "默认不跨脚本组混写；本次未写入任何数据。"
                ),
                "extra": {
                    "position": position,
                    "entry_script_id": entry_script_id,
                    "script_id": script_id,
                },
            }
        return _error_envelope(
            error_code=problem["code"], message=problem["message"], extra=problem["extra"]
        )
    return None


@router.get("/{chapter_id}", response_model=ApiResponse[dict[str, Any]], summary="集级提示词看板（只读）")
async def get_board(chapter_id: str, db: AsyncSession = Depends(get_db)) -> Any:
    shots = await svc.load_board(db, chapter_id=chapter_id)
    return success_response(
        {
            "chapter_id": chapter_id,
            "shots": [shot.to_read() for shot in shots],
            "summary": {
                "total": len(shots),
                "with_prompt": len([shot for shot in shots if shot.has_prompt]),
                "missing": len([shot for shot in shots if not shot.has_prompt]),
            },
            "note": "这里读的是 shot_details.video_prompt（交付导出与视频生成用的同一列）。",
        }
    )


@router.get(
    "/{chapter_id}/readiness",
    response_model=ApiResponse[dict[str, Any]],
    summary="集级就绪批量读取（每镜提示词/绑定/参考帧，只读）",
)
async def get_board_readiness(
    chapter_id: str,
    reference_mode: str = "first",
    db: AsyncSession = Depends(get_db),
) -> Any:
    """顶部三态、未完成镜头定位、生产卡门禁共用的**同一份原始就绪数据**。"""
    return success_response(
        await svc.load_readiness(db, chapter_id=chapter_id, reference_mode=reference_mode)
    )


@router.post("/{chapter_id}/draft", response_model=ApiResponse[dict[str, Any]], summary="单镜生成视频提示词草稿（真 LLM；只落草稿表）")
async def draft_board_shot(chapter_id: str, body: BoardDraftRequest, db: AsyncSession = Depends(get_db)) -> Any:
    """一次只为一镜生成草稿：页面据此维护逐镜队列，用户点停止即不再发下一镜。

    真实生成成功后草稿**立刻落服务端**（刷新/中断不丢），正式提示词列不动；
    同一镜若已有进行中的生成，返回 ``status="busy"`` 且不发起调用（防重复付费）。
    """
    try:
        data = await svc.generate_draft(
            db,
            chapter_id=chapter_id,
            shot_id=body.shot_id,
            mode=body.mode,
            claim_token=body.claim_token,
        )
    except _BLOCKED as exc:
        return paid_outlet_guard.blocked_envelope(exc)
    return success_response(data)


@router.get(
    "/{chapter_id}/drafts",
    response_model=ApiResponse[dict[str, Any]],
    summary="逐镜草稿状态（刷新/中断后恢复队列，只读草稿表）",
)
async def get_board_drafts(chapter_id: str, db: AsyncSession = Depends(get_db)) -> Any:
    return success_response(await svc.load_draft_state(db, chapter_id=chapter_id))


@router.post(
    "/{chapter_id}/drafts",
    response_model=ApiResponse[dict[str, Any]],
    summary="保存一镜草稿（幂等 upsert；不写正式提示词列）",
)
async def save_board_draft(chapter_id: str, body: BoardDraftSaveRequest, db: AsyncSession = Depends(get_db)) -> Any:
    """每镜生成结束后调用：成功存正文、失败存原因。

    正文**只有**经 ``/save`` 才会进 ``shot_details.video_prompt``；
    本接口一个字节都不写正式列。
    """
    data = await svc.save_shot_draft(
        db,
        chapter_id=chapter_id,
        shot_id=body.shot_id,
        status=body.status,
        prompt=body.prompt,
        error=body.error,
        source=body.source,
        model=body.model,
        meta=body.meta,
        claim_token=body.claim_token,
    )
    return success_response(data)


@router.delete(
    "/{chapter_id}/drafts",
    response_model=ApiResponse[dict[str, Any]],
    summary="清草稿（默认整集；可只清指定镜头）",
)
async def delete_board_drafts(
    chapter_id: str,
    shot_ids: str = Query("", description="逗号分隔的镜头 ID；空 = 清整集"),
    db: AsyncSession = Depends(get_db),
) -> Any:
    ids = [item.strip() for item in str(shot_ids or "").split(",") if item.strip()]
    return success_response(await svc.clear_chapter_drafts(db, chapter_id=chapter_id, shot_ids=ids))


@router.post(
    "/{chapter_id}/drafts/claim",
    response_model=ApiResponse[dict[str, Any]],
    summary="抢占一镜「生成中」租约（同一镜防并发生成/重复付费）",
)
async def claim_board_draft(chapter_id: str, body: BoardDraftClaimRequest, db: AsyncSession = Depends(get_db)) -> Any:
    data = await svc.claim_shot_draft(
        db,
        chapter_id=chapter_id,
        shot_id=body.shot_id,
        lease_seconds=body.lease_seconds,
        claim_token=body.claim_token,
    )
    return success_response(data)


@router.post(
    "/{chapter_id}/drafts/release",
    response_model=ApiResponse[dict[str, Any]],
    summary="释放一镜「生成中」租约（不生成时用）",
)
async def release_board_draft(
    chapter_id: str, body: BoardDraftReleaseRequest, db: AsyncSession = Depends(get_db)
) -> Any:
    data = await svc.release_shot_draft(
        db,
        chapter_id=chapter_id,
        shot_id=body.shot_id,
        claim_token=body.claim_token,
        error=body.error,
    )
    return success_response(data)


@router.post("/{chapter_id}/import-parse", response_model=ApiResponse[dict[str, Any]], summary="批量导入：解析并匹配（不落库）")
async def parse_board_import(chapter_id: str, body: BoardImportParseRequest, db: AsyncSession = Depends(get_db)) -> Any:
    shots = await svc.load_board(db, chapter_id=chapter_id)
    preview = svc.match_import_entries(body.text, shots)
    data = preview.to_read()
    data["shots"] = [shot.to_read() for shot in shots]
    return success_response(data)


@router.post("/{chapter_id}/save", response_model=ApiResponse[dict[str, Any]], summary="确认后批量保存（覆盖模式三选一）")
async def save_board(chapter_id: str, body: BoardSaveRequest, db: AsyncSession = Depends(get_db)) -> Any:
    # **第一行**：任何 DB 访问、任何 ``svc.`` 调用之前先把巨日禄脚本组范围校验掉。
    # 校验不通过就整批拒绝 —— 一个字节都不写（也不会"写一半才发现跨组"）。
    rejected = _validate_jurilu_script_scope(body)
    if rejected is not None:
        return rejected
    data = await svc.save_entries(
        db,
        chapter_id=chapter_id,
        entries=[item.model_dump() for item in body.entries],
        mode=body.mode,
        origin=body.origin,
        selected_shot_ids=body.selected_shot_ids,
        allow_partial=body.allow_partial,
    )
    # 审计回显：本次是按**哪一个**脚本组保存的（其它来源回显空串）
    if isinstance(data, dict):
        data["script_id"] = str(body.script_id or "").strip()
    return success_response(data)
