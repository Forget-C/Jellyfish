"""Chapter CRUD（从 projects.py 拆分）。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.utils import apply_keyword_filter, apply_order, error_envelope, paginate
from app.dependencies import get_db
from app.models.studio import Chapter, ChapterAssetProfile, Project, Shot
from app.schemas.common import ApiResponse, PaginatedData, created_response, empty_response, paginated_response, success_response
from app.services.common import (
    create_and_refresh,
    delete_if_exists,
    entity_already_exists,
    entity_not_found,
    ensure_not_exists,
    flush_and_refresh,
    get_or_404,
    patch_model,
    require_entity,
)
from app.schemas.studio.projects import ChapterCreate, ChapterRead, ChapterUpdate
from app.services.studio.chapter_asset_candidates import build_chapter_asset_candidates
from app.services.studio.asset_overlays import load_chapter_overlays
from app.services.studio.asset_workbench import build_chapter_asset_workbench
from app.services.studio.chapter_asset_profile_confirm import confirm_chapter_asset_profiles
from app.services.studio.chapter_asset_profiles import (
    build_chapter_asset_profiles,
    load_chapter_asset_records,
)
from app.services.studio.chapter_asset_record_store import (
    apply_manual_edit,
    record_to_read,
    resolve_pending_changes,
)
from app.services.studio.global_asset_updates import apply_global_updates, preview_global_updates

router = APIRouter()

CHAPTER_ORDER_FIELDS = {"index", "title", "created_at", "updated_at", "storyboard_count", "status"}


class ChapterAssetProfileBuildRequest(BaseModel):
    """结构化资产清单的生成请求（全部可空：默认只用本章剧本 + 分镜 + 模型配置）。"""

    extra_instructions: str = Field("", description="附加要求（可选；会进提示词的「附加要求」段）")
    refresh: bool = Field(
        False,
        description=(
            "是否**强制重新分析**。默认 false：库里有这份清单就直接读库返回（不调用模型、不花钱）；"
            "true 才会重新调用文本模型，并把新结果逐条对账入库"
            "（已确认/人工改过的行只记待决定，不覆盖）。"
        ),
    )


class ChapterAssetProfileEditRequest(BaseModel):
    """人工修改 / 用户补充（写进 ``manual_overrides`` 与 ``user_notes``，模型结果永不覆盖）。"""

    fields: dict[str, Any] = Field(
        default_factory=dict,
        description="按字段键覆盖的结构化资料（键见清单的 field_labels；只覆盖给出的键）",
    )
    notes: list[str] = Field(default_factory=list, description="用户补充条目（追加，自动去重）")
    aliases: list[str] = Field(default_factory=list, description="补充别名（并入现有别名集合）")


class ChapterAssetProfileDecision(BaseModel):
    """单条"内容已变化"的处置决定。"""

    group_key: str = Field(..., description="资料行的 group_key（格式 类型:归一化名称）")
    action: str = Field(..., description="overwrite（覆盖）/ merge（合并）/ keep（保留）")


class ChapterAssetProfileDecisionsRequest(BaseModel):
    """批量处置"内容已变化"的资料行（对应用户点名的：由用户决定覆盖、合并或保留）。"""

    decisions: list[ChapterAssetProfileDecision] = Field(default_factory=list)


class ChapterAssetProfileSelection(BaseModel):
    """冲突项/指定项的人工决定（只有需要人工处理时才传）。"""

    group_key: str = Field(..., description="清单返回的 group_key（格式 类型:归一化名称）")
    action: str = Field(..., description="create_new / link_existing / skip")
    asset_id: str | None = Field(None, description="action=link_existing 时要选用的已有资产 ID")
    confirm_conflict: bool = Field(False, description="该项存在冲突时，必须显式置 true 才会写入")
    reason: str = Field("", description="人工决定的说明（可选，会原样回显在结果里）")


class GlobalAssetUpdatePreviewRequest(BaseModel):
    """全局资产更新的差异预览请求（只读）。"""

    asset_types: list[str] = Field(
        default_factory=list,
        description="只看这几类全局资产（scene/prop/costume）；为空表示全部",
    )


class ChapterAssetProfileConfirmRequest(BaseModel):
    """结构化资产清单的确认落库请求。"""

    auto_confirm_unconflicted: bool = Field(
        True,
        description="无冲突项是否直接确认（true 时不需要逐个点；冲突项一律仍需人工决定）",
    )
    confirm_conflict: bool = Field(False, description="是否整体接受本次 selections 里冲突项的人工决定")
    selections: list[ChapterAssetProfileSelection] = Field(
        default_factory=list,
        description="需要人工处理时的逐项决定（无冲突项不必出现在这里）",
    )
    extra_instructions: str = Field(
        "",
        description="与生成本清单时**完全一致**的附加要求（内容签名要对得上，否则会要求重新生成）",
    )


@router.get(
    "",
    response_model=ApiResponse[PaginatedData[ChapterRead]],
    summary="章节列表（分页）",
)
async def list_chapters(
    db: AsyncSession = Depends(get_db),
    project_id: str | None = Query(None, description="按项目过滤"),
    q: str | None = Query(None, description="关键字，过滤 title/summary"),
    order: str | None = Query(None, description="排序字段"),
    is_desc: bool = Query(False, description="是否倒序"),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
) -> ApiResponse[PaginatedData[ChapterRead]]:
    stmt = select(Chapter)
    if project_id:
        stmt = stmt.where(Chapter.project_id == project_id)
    stmt = apply_keyword_filter(stmt, q=q, fields=[Chapter.title, Chapter.summary])
    stmt = apply_order(
        stmt,
        model=Chapter,
        order=order,
        is_desc=is_desc,
        allow_fields=CHAPTER_ORDER_FIELDS,
        default="index",
    )
    items, total = await paginate(db, stmt=stmt, page=page, page_size=page_size)

    chapter_ids = [c.id for c in items]
    shot_count_by_chapter: dict[str, int] = {}
    if chapter_ids:
        count_stmt = (
            select(Shot.chapter_id, func.count(Shot.id))
            .where(Shot.chapter_id.in_(chapter_ids))
            .group_by(Shot.chapter_id)
        )
        res = await db.execute(count_stmt)
        shot_count_by_chapter = {str(ch_id): int(cnt) for ch_id, cnt in res.all()}

    return paginated_response(
        [
            ChapterRead.model_validate(x).model_copy(update={"shot_count": shot_count_by_chapter.get(x.id, 0)})
            for x in items
        ],
        page=page,
        page_size=page_size,
        total=total,
    )


@router.post(
    "",
    response_model=ApiResponse[ChapterRead],
    status_code=status.HTTP_201_CREATED,
    summary="创建章节",
)
async def create_chapter(
    body: ChapterCreate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ChapterRead]:
    await ensure_not_exists(
        db,
        Chapter,
        body.id,
        detail=entity_already_exists("Chapter"),
    )
    await require_entity(
        db,
        Project,
        body.project_id,
        detail=entity_not_found("Project"),
        status_code=400,
    )
    obj = await create_and_refresh(db, Chapter(**body.model_dump()))
    return created_response(ChapterRead.model_validate(obj))


@router.get(
    "/{chapter_id}",
    response_model=ApiResponse[ChapterRead],
    summary="获取章节",
)
async def get_chapter(
    chapter_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ChapterRead]:
    obj = await get_or_404(db, Chapter, chapter_id, detail=entity_not_found("Chapter"))
    count_stmt = select(func.count(Shot.id)).where(Shot.chapter_id == chapter_id)
    res = await db.execute(count_stmt)
    shot_count = int(res.scalar() or 0)
    return success_response(ChapterRead.model_validate(obj).model_copy(update={"shot_count": shot_count}))


@router.patch(
    "/{chapter_id}",
    response_model=ApiResponse[ChapterRead],
    summary="更新章节",
)
async def update_chapter(
    chapter_id: str,
    body: ChapterUpdate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ChapterRead]:
    obj = await get_or_404(db, Chapter, chapter_id, detail=entity_not_found("Chapter"))
    update = body.model_dump(exclude_unset=True)
    if "project_id" in update:
        await require_entity(
            db,
            Project,
            update["project_id"],
            detail=entity_not_found("Project"),
            status_code=400,
        )
    patch_model(obj, update)
    await flush_and_refresh(db, obj)
    return success_response(ChapterRead.model_validate(obj))


@router.get(
    "/{chapter_id}/asset-candidates",
    response_model=ApiResponse[dict[str, Any]],
    summary="集级资产清单（六步流程·步骤2：聚合提取候选 + 是否已有同名资产）",
)
async def get_chapter_asset_candidates(
    chapter_id: str,
    include_ignored: bool = Query(False, description="是否把已忽略的候选也计入"),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[dict[str, Any]]:
    """把一章内各镜头的提取候选按「类型 + 归一化名称」聚合成可确认的资产清单。

    只聚合与提示，**不建资产、不写库**；每条会给出 ``recommendation``：
    已有同名资产 → ``link_existing``（选用已有），否则 → ``create_new``（新建）。
    """
    return success_response(
        await build_chapter_asset_candidates(db, chapter_id=chapter_id, include_ignored=include_ignored)
    )


@router.post(
    "/{chapter_id}/asset-profiles",
    response_model=ApiResponse[dict[str, Any]],
    summary="结构化资产清单（六步流程·步骤2：基于本章完整剧本 + 分镜，复用上游整集分析能力）",
)
async def post_chapter_asset_profiles(
    chapter_id: str,
    body: ChapterAssetProfileBuildRequest | None = None,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[dict[str, Any]]:
    """基于**本章完整剧本 + 本章分镜**生成规范化的角色/场景/道具/服装清单。

    与 ``/asset-candidates`` 的区别（也是本次修通数据链路的关键）：

    - ``/asset-candidates`` 只把**已经落库的镜头候选**按名称聚合一下，不读剧本、
      不产出资料；确认后资产描述仍是空的；
    - 本接口读**本章完整剧本**与分镜，调用既有 LLM 编排层（同一套 Provider / 守卫）
      产出每项资产的**结构化资料**（角色：外貌/发型/服装配饰/性格气质…
      场景：空间结构/陈设/光线色调… 道具：材质/颜色/形状/尺寸… 服装：款式/颜色/材质/配饰…），
      并保留"哪一段原文、哪个镜头"的依据。

    **数据库是事实来源**（2026-09 持久化改造）：

    - ``refresh=false``（默认）且库里已有这份清单 → **直接读库返回**，不调用任何模型
      （后端重启后同样如此），返回值与"刚生成时"逐字段同形；剧本/分镜变了会带
      ``persistence.content_changed=true`` 与中文提示「内容已变化，建议重新分析」，
      **不覆盖任何资料**；
    - ``refresh=true`` → 重新分析，并把结果逐条对账入库：未确认且未人工改过的行更新；
      已确认 / 人工改过的行只在 ``pending_*`` 记录新结果并标 ``pending_change``，
      等用户决定覆盖 / 合并 / 保留；本次没再提到的行**不删除**；
    - ``user_flow`` 是用户主流程要看的（一项资产一行，含资料、缺什么、出场镜头、
      建议动作、要不要人工处理）；``technical_detail`` 是默认收起的。

    **本接口不建资产、不出图**；确认请调用同章的
    ``POST /{chapter_id}/asset-profiles/confirm``。
    """
    try:
        data = await build_chapter_asset_profiles(
            db,
            chapter_id=chapter_id,
            extra_instructions=(body.extra_instructions if body else ""),
            refresh=bool(body.refresh) if body else False,
        )
    except HTTPException as exc:
        # 结构化明细（code / fix / issues）放进 meta.error，而不是被全局处理器压成一行字符串
        return error_envelope(code=exc.status_code, detail=exc.detail)
    return success_response(data)


@router.get(
    "/{chapter_id}/asset-profiles",
    response_model=ApiResponse[dict[str, Any]],
    summary="结构化资产清单（GET 只读入口：只读库，绝不调用模型）",
)
async def get_chapter_asset_profiles(
    chapter_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[dict[str, Any]]:
    """**只读**入口：把库里保存的清单读出来，一次模型调用都不发。

    与 POST 的区别（这是刻意的不对称）：

    - GET 永远不花钱：库里没有这份清单时返回空清单 +
      ``persistence.status="not_generated"`` 的中文引导，而不是偷偷生成；
    - 要生成（或强制重新分析）请用 ``POST`` 且带 ``refresh=true``。
    """
    try:
        data = await build_chapter_asset_profiles(db, chapter_id=chapter_id, allow_generate=False)
    except HTTPException as exc:
        return error_envelope(code=exc.status_code, detail=exc.detail)
    return success_response(data)


@router.get(
    "/{chapter_id}/asset-workbench",
    response_model=ApiResponse[dict[str, Any]],
    summary="资产生产工作台（第2步的单一数据源：一项资产只出现一次，四个页签共用）",
)
async def get_chapter_asset_workbench(
    chapter_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[dict[str, Any]]:
    """**只读**入口：这一页要看的资产都在这份响应里，页面不再各拉一张表。

    - ``analysis``：本章资产资料的状态（尚未生成 / 已生成 / 内容已变化 / 只有资料行），
      以及"下一步该点哪个按钮"的中文提示（``hint``）；
    - ``summary``：由 ``items`` **现算**的计数（顶部统计与列表同源，不允许两套算法）；
    - ``items``：一项资产一行 —— 资料、剧本依据、提示词与质量、图片状态、下一步状态；
      四个页签（人物 / 场景 / 道具 / 服装）按 ``asset_type`` 分流，同一资产只出现一次；
    - ``pending_review``：**只收真正需要人工**的（别名指向两个不同资产、同名异类、
      同一名称的候选关联了不同资产、候选里有服装但还没有服装资产）；
      无冲突的候选按既有 ``auto_confirm_unconflicted`` 口径自动合并 / 自动匹配；
    - ``technical``：候选条数、聚合组、匹配诊断等后台维度（前端默认收起）。

    **本接口不调用任何模型、不出图、不写库**：内容变化时只如实回报
    ``analysis.status="stale"``，不改写任何行（标记 stale 仍走既有读路径）。
    """
    try:
        data = await build_chapter_asset_workbench(db, chapter_id=chapter_id)
    except HTTPException as exc:
        return error_envelope(code=exc.status_code, detail=exc.detail)
    return success_response(data)


@router.post(
    "/{chapter_id}/asset-profiles/confirm",
    response_model=ApiResponse[dict[str, Any]],
    summary="确认结构化资产清单：无冲突项直接建/绑，冲突项需人工决定",
)
async def post_chapter_asset_profiles_confirm(
    chapter_id: str,
    body: ChapterAssetProfileConfirmRequest | None = None,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[dict[str, Any]]:
    """把最新一份结构化清单确认落库（一次请求一个事务，全有或全无）。

    规则：

    - **无冲突项**（``auto_confirmable``）默认动作直接执行：库里有同名同类型且描述不矛盾
      → 选用已有（不新建重复资产）；没有 → 新建；
    - **冲突项**（``needs_review``）**不会**被自动写入：必须在 ``selections`` 里给出
      ``group_key`` + ``action``，并且带 ``confirm_conflict=true``；否则原样跳过，
      ``results`` 里如实给出冲突原因；
    - 结构化资料写进资产 ``description`` 与候选 ``payload``（既有列，未加列）；
    - **已有内容一律不覆盖**：已有描述、``image_prompts``、图片行（含定版）全部原样保留，
      本接口连图片表都不碰。

    返回里直接带 ``asset_readiness``（与 ``GET /studio/projects/{id}/asset-readiness``
    同一份口径），确认后生产区立即能读到。
    """
    payload = body or ChapterAssetProfileConfirmRequest()
    try:
        data = await confirm_chapter_asset_profiles(
            db,
            chapter_id=chapter_id,
            selections=[item.model_dump() for item in payload.selections],
            auto_confirm_unconflicted=payload.auto_confirm_unconflicted,
            confirm_conflict=payload.confirm_conflict,
            extra_instructions=payload.extra_instructions,
        )
    except HTTPException as exc:
        return error_envelope(code=exc.status_code, detail=exc.detail)
    return success_response(data)


@router.get(
    "/{chapter_id}/asset-profiles/records",
    response_model=ApiResponse[dict[str, Any]],
    summary="本章持久化资产资料（数据库是事实来源的读入口：重启不丢、重新提取不丢）",
)
async def get_chapter_asset_profile_records(
    chapter_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[dict[str, Any]]:
    """直接读**专用表**里本章的资产资料（`chapter_asset_profiles`）。

    每条记录都带：资产类型 / 规范名称 / 别名 / 结构化资料（**已合并人工修改**）/
    人工修改与用户补充（分开存） / 剧本片段与分镜依据 / 已关联的真实资产 ID /
    剧本来源签名（``source_hash``）与来源摘要 / 状态与时间。

    ``summary.pending_change`` 不为 0 时，说明有行的资料"内容已变化"，
    请用 ``POST .../asset-profiles/decisions`` 决定覆盖 / 合并 / 保留。
    """
    try:
        data = await load_chapter_asset_records(db, chapter_id=chapter_id)
    except HTTPException as exc:
        return error_envelope(code=exc.status_code, detail=exc.detail)
    return success_response(data)


@router.patch(
    "/{chapter_id}/asset-profiles/records/{record_id}",
    response_model=ApiResponse[dict[str, Any]],
    summary="人工修改本章资产资料（写进 manual_overrides / user_notes，模型结果永不覆盖）",
)
async def patch_chapter_asset_profile_record(
    chapter_id: str,
    record_id: int,
    body: ChapterAssetProfileEditRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[dict[str, Any]]:
    """人工修改 / 用户补充（这是"重新提取不丢人工修改"的写入端）。

    - 给出的字段写进 ``manual_overrides``（字段级覆盖），**不动**模型侧的 ``profile``；
    - ``notes`` 追加进 ``user_notes``；``aliases`` 并入别名集合；
    - 写入后这一行即视为**受保护**：后续任何一次重新分析都不会覆盖它，
      只会把新结果记到 ``pending_*`` 等用户决定。
    """
    record = await db.get(ChapterAssetProfile, record_id)
    if record is None or str(record.chapter_id) != chapter_id:
        return error_envelope(code=404, detail=entity_not_found("ChapterAssetProfile"))
    try:
        updated = await apply_manual_edit(
            db,
            record=record,
            fields=body.fields,
            notes=body.notes,
            aliases=body.aliases,
        )
    except HTTPException as exc:
        return error_envelope(code=exc.status_code, detail=exc.detail)
    # 事务由 get_db 依赖在请求结束时统一提交；刷新一次再组装响应，
    # 免得 onupdate 列在 UPDATE 之后处于"过期"状态（async 会话里会抛 MissingGreenlet）。
    await db.refresh(updated)
    data = record_to_read(updated)
    data["note"] = (
        "人工修改已保存在 manual_overrides / user_notes：模型结果不会覆盖它们；"
        "本接口不写全局资产的通用资料、不写 image_prompts、不碰图片与定版图。"
    )
    return success_response(data)


@router.post(
    "/{chapter_id}/asset-profiles/decisions",
    response_model=ApiResponse[dict[str, Any]],
    summary="处置「内容已变化」的资产资料：覆盖 / 合并 / 保留（用户显式决定）",
)
async def post_chapter_asset_profile_decisions(
    chapter_id: str,
    body: ChapterAssetProfileDecisionsRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[dict[str, Any]]:
    """剧本/分镜变化后重新分析，**受保护行**（已确认或人工改过）不自动覆盖；
    用户在这里显式决定怎么处置：

    - ``overwrite``（覆盖）：用新分析结果替换模型侧资料；**人工修改与用户补充保留**；
    - ``merge``（合并）：以现有资料为准，只补上还没有的字段，依据取并集；
    - ``keep``（保留）：丢弃本次新结果，现有资料一个字都不动。
    """
    try:
        data = await resolve_pending_changes(db, chapter_id=chapter_id, decisions=[item.model_dump() for item in body.decisions])
    except HTTPException as exc:
        return error_envelope(code=exc.status_code, detail=exc.detail)
    return success_response(data)


@router.get(
    "/{chapter_id}/asset-overlays",
    response_model=ApiResponse[dict[str, Any]],
    summary="本章资产资料（章节隔离层）：全局资产的剧情身份 / 出场依据 / 临时补充",
)
async def get_chapter_asset_overlays(
    chapter_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[dict[str, Any]]:
    """读回**本章**保存的资产资料（overlay）。

    为什么要单独一个读接口：场景 / 道具 / 服装是**全局资产**，本章提取出的
    剧情身份、出场依据、临时补充**不能**写进它们的通用资料，只能按项目/章节隔离保存。
    这个接口就是"我这一章的资料存在哪、存了什么"的唯一读入口（默认收起在技术详情里）。

    返回每项都带 ``scope: "chapter"`` 与 ``global_asset``：
    全局资产额外说明"不会写回全局资产的通用资料或图片提示词"。
    """
    overlays = await load_chapter_overlays(db, chapter_id=chapter_id)
    return success_response(
        {
            "chapter_id": chapter_id,
            "items": [
                {
                    **overlay,
                    "scope": "chapter",
                    "scope_description": (
                        "该资产是**全局资产**；这里的资料按项目/章节隔离保存，"
                        "不会写回全局资产的通用资料或图片提示词。"
                        if overlay.get("global_asset")
                        else "该资产归属项目（角色），资料保存在本项目内。"
                    ),
                }
                for overlay in overlays
            ],
            "summary": {
                "total": len(overlays),
                "global_assets": len([item for item in overlays if item.get("global_asset")]),
                "project_assets": len([item for item in overlays if not item.get("global_asset")]),
            },
            "note": (
                "本章资料（剧情身份 / 出场依据 / 临时补充）按项目+章节隔离保存；"
                "要更新全局资产的通用资料，请走 global-updates 的差异预览 + 显式确认。"
            ),
        }
    )


@router.post(
    "/{chapter_id}/asset-profiles/global-updates/preview",
    response_model=ApiResponse[dict[str, Any]],
    summary="全局资产更新差异预览（只读：不写库、不改图片提示词）",
)
async def post_global_updates_preview(
    chapter_id: str,
    body: GlobalAssetUpdatePreviewRequest | None = None,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[dict[str, Any]]:
    """算出"要不要把本章**通用资料**合并进全局资产"，并按「；」分段给出新增/删除/未变。

    刻意排除本章特有字段（场景的时间天气/光线色调/相关事件、道具的状态/剧情作用、
    服装的使用场合、角色的相关剧情）—— 它们永远只留在章节 overlay 里。

    **本接口不写库**：``requires_confirmation`` 恒为 ``true``。
    """
    payload = body or GlobalAssetUpdatePreviewRequest()
    try:
        data = await preview_global_updates(db, chapter_id=chapter_id, asset_types=payload.asset_types)
    except HTTPException as exc:
        return error_envelope(code=exc.status_code, detail=exc.detail)
    return success_response(data)


@router.post(
    "/{chapter_id}/asset-profiles/global-updates/apply",
    response_model=ApiResponse[dict[str, Any]],
    summary="把本章通用资料写回全局资产（必须显式确认；图片提示词默认不动）",
)
async def post_global_updates_apply(
    chapter_id: str,
    body: dict[str, Any],
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[dict[str, Any]]:
    """全局资产更新（**白名单 + 显式确认**）。

    硬约束：

    - 请求体必须带 ``"confirm": true``，否则结构化 **409**（并把差异摘要一起返回）；
    - 必须逐项列出 ``asset_type`` / ``asset_id`` / ``apply[]``，``apply`` 只能含
      ``description`` / ``image_prompts`` 白名单字段；
    - ``image_prompts`` 还要额外带 ``confirm_replace_image_prompt: true``（沿用既有覆盖保护）；
    - 本章特有字段（时间天气/光线色调/状态/场合/相关剧情）**永远不写全局**。
    """
    try:
        data = await apply_global_updates(db, chapter_id=chapter_id, body=body)
    except HTTPException as exc:
        return error_envelope(code=exc.status_code, detail=exc.detail)
    return success_response(data)


@router.delete(
    "/{chapter_id}",
    response_model=ApiResponse[None],
    summary="删除章节",
)
async def delete_chapter(
    chapter_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[None]:
    await delete_if_exists(db, Chapter, chapter_id)
    return empty_response()
