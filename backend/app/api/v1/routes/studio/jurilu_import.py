"""巨日禄 Cookie 导入路由（预览 + 写入）。

设计点
------
* 两个端点都**重新抓取一次**，不依赖服务端会话状态 —— 前端不需要把计划回传，
  也就无法被篡改导致写到计划外的镜头。
* **不写库的预览**与**写库的提交**分开：预览可反复调，提交才落盘。
* Cookie / Authorization 只作为请求体传入，**不回显、不落库**；失败诊断落日志时也只写
  状态码 / 请求头**名字** / 布尔值 / 已脱敏的响应片段，不含任何凭证内容。
* 抓取失败（Cookie 过期 / URL 不对）返回 502，结构化诊断放在响应的 ``meta`` 里
  —— 本项目有全局异常处理器，会把 ``HTTPException.detail`` 拍平成一行字符串，
  诊断信息若走 ``detail`` 就丢了结构。这里直接构造 JSONResponse 绕开该拍平。
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.models.studio import Chapter
from app.schemas.common import ApiResponse, success_response
from app.services.external import jurilu_import_plan as planner
from app.services.external import jurilu_import_service as svc

router = APIRouter()
logger = logging.getLogger(__name__)


class JuriluImportRequest(BaseModel):
    """导入入参。字段命名对齐中控台面板的 5 个输入 + 2 个开关（外加脚本组选择）。"""

    chapter_id: str = Field(description="目标章节 ID（提示词写到这个章节的镜头上）")
    url: str = Field(description="巨日禄页面 URL（需含 projectId / clipId）")
    cookie: str = Field(default="", description="整段「复制全部 Cookie」（不保存、不写日志）")
    authorization: str = Field(default="", description="Authorization 单值（可留空）")
    auth_mode: str = Field(default="auto", description="自动 / 不发送 / 原样发送 / Bearer")
    referer: str = Field(default="", description="Referer 覆盖（可留空）")
    api_url_override: str = Field(default="", description="高级：API 覆盖地址（可留空）")
    create_missing: bool = Field(default=True, description="分镜多于镜头时是否新建镜头")
    overwrite: bool = Field(default=False, description="目标镜头已有不同提示词时是否覆盖")
    script_ids: list[str] = Field(
        default_factory=list,
        description=(
            "用户选择的脚本组：**一次只能传 1 个** scriptId。空数组 = 还没选组："
            "只返回 script_groups，不做任何匹配（默认不跨 scriptId 合并）；"
            "传 2 个及以上会被 400 拒绝"
        ),
    )


class JuriluPlanRowRead(BaseModel):
    """配对计划中的一行（统一预览直接照抄即可）。"""

    action: str
    order: int
    label: str
    summary: str
    prompt: str
    source: str
    reason: str = ""
    shot_id: str = ""
    index: int = 0
    title: str = ""
    script_id: str = Field("", description="这一行来自哪个脚本组（scriptId）")
    seq: int = Field(0, description="巨日禄分镜序号（seqNum）")
    matched_by: str = Field(
        "", description="怎么配上的：seq（编号优先）/ order（顺序兜底）/ created（新建）/ none"
    )


class JuriluSampleRecordRead(BaseModel):
    """脚本组的一条采样分镜：让用户确认「正文 / 序号 / 提示词」解析正确。"""

    seq: str = ""
    sbid: str = ""
    prompt_head: str = Field("", description="提示词正文前 60 字")
    prompt_length: int = 0
    summary_head: str = Field("", description="分镜摘要前 40 字")


class JuriluScriptGroupRead(BaseModel):
    """一个 scriptId = 一个脚本组（永远一条一组，默认不跨组合并）。"""

    script_id: str
    title: str = ""
    title_source: str = Field("", description="标题实际命中的字段名；取不到则空")
    created_at: str = ""
    created_source: str = Field("", description="创建时间实际命中的字段名；取不到则空")
    updated_at: str = ""
    updated_source: str = Field("", description="更新时间实际命中的字段名；取不到则空")
    record_count: int = 0
    seq_min: str = ""
    seq_max: str = ""
    seq_field: str = Field("", description="序号取自哪个字段（seqNum / sbid；无则空）")
    pages_fetched: int = Field(0, description="该组分镜接口实际翻了几页（整组取全的证据）")
    sample_records: list[JuriluSampleRecordRead] = Field(default_factory=list)
    raw_keys: list[str] = Field(
        default_factory=list, description="第一步记录的字段名列表（只有名字，不含值）"
    )
    facts: list[str] = Field(
        default_factory=list, description="客观事实逐条（记录数 / 序号范围 / 时间戳 / 与其他组的重合度）"
    )
    likely_newest: bool = Field(
        False,
        description="只有在真实拿到可比较的时间戳且能分出先后时才为 true；无时间戳一律 false",
    )
    version_reasons: list[str] = Field(default_factory=list)
    version_hint: str = ""


class JuriluPreviewRead(BaseModel):
    """预览结果：将要发生什么。"""

    project_id: str
    chapter_id: str
    chapter_shot_count: int
    entry_count: int
    plan_summary: str
    counts: dict[str, int]
    rows: list[JuriluPlanRowRead]
    missing_shot_count: int = Field(0, description="镜头数不足、需要新建的条数")
    diagnostics: dict = Field(default_factory=dict, description="脱敏后的抓取诊断")
    warnings: list[str] = Field(default_factory=list)
    jurilu_project_id: str = ""
    jurilu_clip_id: str = ""
    source_url: str = ""
    script_groups: list[JuriluScriptGroupRead] = Field(
        default_factory=list, description="按 scriptId 分好的脚本组（默认不合并）"
    )
    selected_script_ids: list[str] = Field(default_factory=list)
    selected_script_id: str = Field("", description="所选脚本组（单数语义，未选则空）")
    requires_script_selection: bool = Field(
        False, description="true = 用户还没选组，本轮不做匹配、不写库"
    )
    note: str = Field("", description="口径说明（默认不跨 scriptId 合并 / 一次只能导入一个脚本组）")


class JuriluApplyRead(BaseModel):
    """写入结果。"""

    project_id: str
    chapter_id: str
    updated: int
    created: int
    written: int
    touched_shot_ids: list[str]
    counts: dict[str, int]
    plan_summary: str


async def _require_chapter_in_project(
    db: AsyncSession, *, project_id: str, chapter_id: str
) -> Chapter:
    row = await db.execute(select(Chapter).where(Chapter.id == chapter_id))
    chapter = row.scalar_one_or_none()
    if chapter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chapter not found")
    if str(getattr(chapter, "project_id", "")) != str(project_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="章节不属于该项目",
        )
    return chapter


def _gateway_error(exc: svc.JuriluImportError) -> JSONResponse:
    """把抓取失败整理成统一信封，诊断信息放 ``meta``（保持结构，不被拍平）。"""
    # 同时把**脱敏**诊断落一份服务端日志：页面上只有一行摘要，
    # 「第一步 200 / 第二步 0 条」这类问题没有服务端留证就只能靠猜。
    # 内容只含 状态码 / 头名 / 布尔值 / 已脱敏响应片段，绝无凭证值。
    logger.warning(
        "jurilu 导入失败：%s ｜ diagnostics=%s ｜ warnings=%s",
        exc,
        json.dumps(exc.diagnostics, ensure_ascii=False, default=str)[:2000],
        json.dumps(exc.warnings, ensure_ascii=False, default=str)[:800],
    )
    body = ApiResponse[None](
        code=status.HTTP_502_BAD_GATEWAY,
        message=str(exc),
        data=None,
        meta={
            "diagnostics": exc.diagnostics,
            "warnings": exc.warnings,
        },
    ).model_dump()
    return JSONResponse(status_code=status.HTTP_502_BAD_GATEWAY, content=body)


def _selection_error(exc: svc.JuriluSelectionError) -> JSONResponse:
    """用户选的脚本组非法（不存在 / 一次选了多个）→ **400**。

    抓取本身是成功的，所以不是 502 网关错误。诊断里给出本次真实抓到的脚本组，
    用户照着重新选即可；同样只含 scriptId / 标题 / 条数，不含正文与凭证。
    """
    logger.warning(
        "jurilu 导入脚本组选择非法：%s ｜ available=%s",
        exc,
        json.dumps(exc.available_script_ids, ensure_ascii=False, default=str)[:400],
    )
    body = ApiResponse[None](
        code=status.HTTP_400_BAD_REQUEST,
        message=str(exc),
        data=None,
        meta={
            "available_script_ids": exc.available_script_ids,
            "script_groups": exc.script_groups,
            "note": f"{svc.SINGLE_GROUP_NOTE}；{svc.NO_MERGE_NOTE}",
        },
    ).model_dump()
    return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content=body)


def _require_single_script_selection(script_ids: list[str], *, endpoint: str) -> None:
    """**恰好一个**语义的强制点（在抓取之前就拒绝，连上游都不碰）。

    * 0 个：``endpoint`` 允许（preview 只返回脚本组，不做匹配）；
    * 1 个：放行；
    * >=2 个：**一律 400** —— 一次抓到的多个 scriptId 是不同的脚本
      （或同一脚本的不同版本），「109 条 = 同一集连续镜头」这个错误前提
      一旦被接受就会一路写进库里。

    apply（写库）额外要求非空：它必须显式选定一个组。
    """
    # 先去重（同一个 scriptId 传两遍不算「选了多组」），与服务层口径保持一致
    cleaned: list[str] = []
    for item in script_ids:
        text = str(item or "").strip()
        if text and text not in cleaned:
            cleaned.append(text)
    if len(cleaned) > 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"{svc.SINGLE_GROUP_NOTE}：script_ids 只能传 1 个 scriptId，"
                f"本次收到 {len(cleaned)} 个（{'、'.join(cleaned)}）。"
                f"请先选定一个脚本组再重试（{svc.NO_MERGE_NOTE}）。"
            ),
        )
    if not cleaned and endpoint == "apply":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"apply（写库）必须显式指定恰好 1 个 script_ids。"
                f"{svc.NO_MERGE_NOTE}，{svc.SINGLE_GROUP_NOTE}。请先调 preview 选好脚本组。"
            ),
        )


@router.post(
    "/{project_id}/preview",
    response_model=ApiResponse[JuriluPreviewRead],
    summary="巨日禄导入预览（抓取 + 分组 + 配对，不写库）",
)
async def preview_jurilu_import(
    project_id: str,
    body: JuriluImportRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[JuriluPreviewRead] | JSONResponse:
    await _require_chapter_in_project(db, project_id=project_id, chapter_id=body.chapter_id)
    # 预览也要求「恰好一个」：0 个只是「还没选」，>=2 个直接拒绝
    _require_single_script_selection(body.script_ids, endpoint="preview")
    try:
        result = await svc.build_preview(
            db,
            chapter_id=body.chapter_id,
            url=body.url,
            cookie=body.cookie,
            authorization=body.authorization,
            auth_mode=body.auth_mode,
            referer=body.referer,
            api_url_override=body.api_url_override,
            create_missing=body.create_missing,
            overwrite=body.overwrite,
            script_ids=body.script_ids,
        )
    except svc.JuriluSelectionError as exc:
        return _selection_error(exc)
    except svc.JuriluImportError as exc:
        return _gateway_error(exc)

    plan = result["plan"]
    return success_response(
        JuriluPreviewRead(
            project_id=project_id,
            chapter_id=result["chapter_id"],
            chapter_shot_count=result["chapter_shot_count"],
            entry_count=result["entry_count"],
            plan_summary=result["plan_summary"],
            counts=plan["counts"],
            rows=[JuriluPlanRowRead(**row) for row in plan["rows"]],
            missing_shot_count=result["missing_shot_count"],
            diagnostics=result["diagnostics"],
            warnings=result["warnings"],
            jurilu_project_id=result["jurilu_project_id"],
            jurilu_clip_id=result["jurilu_clip_id"],
            source_url=result["source_url"],
            script_groups=[
                JuriluScriptGroupRead(**group) for group in result["script_groups"]
            ],
            selected_script_ids=result["selected_script_ids"],
            selected_script_id=result["selected_script_id"],
            requires_script_selection=result["requires_script_selection"],
            note=result["note"],
        )
    )


@router.post(
    "/{project_id}/apply",
    response_model=ApiResponse[JuriluApplyRead],
    summary="巨日禄导入提交（抓取 + 分组 + 配对 + 写库）",
)
async def apply_jurilu_import(
    project_id: str,
    body: JuriluImportRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[JuriluApplyRead] | JSONResponse:
    await _require_chapter_in_project(db, project_id=project_id, chapter_id=body.chapter_id)
    # 写库端点**必须**恰好选一个组（在抓取之前就拒绝，连上游都不碰）
    _require_single_script_selection(body.script_ids, endpoint="apply")
    try:
        result = await svc.build_preview(
            db,
            chapter_id=body.chapter_id,
            url=body.url,
            cookie=body.cookie,
            authorization=body.authorization,
            auth_mode=body.auth_mode,
            referer=body.referer,
            api_url_override=body.api_url_override,
            create_missing=body.create_missing,
            overwrite=body.overwrite,
            script_ids=body.script_ids,
        )
    except svc.JuriluSelectionError as exc:
        return _selection_error(exc)
    except svc.JuriluImportError as exc:
        return _gateway_error(exc)

    if not planner.writable_rows(result["plan"]["rows"]):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "没有可写入的内容：可能是全部条目为空、全部已存在，"
                "或目标镜头已有不同提示词而你没开「允许覆盖」。"
                f"（{result['plan_summary']}）"
            ),
        )

    written = await svc.apply_plan(db, chapter_id=body.chapter_id, plan=result["plan"])
    return success_response(
        JuriluApplyRead(
            project_id=project_id,
            chapter_id=written["chapter_id"],
            updated=written["updated"],
            created=written["created"],
            written=written["written"],
            touched_shot_ids=written["touched_shot_ids"],
            counts=written["counts"],
            plan_summary=result["plan_summary"],
        )
    )


__all__ = ["router"]
