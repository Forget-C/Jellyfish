"""一键技能（导演 Skill）路由：列 Skill、装配上下文、生成提示词、导出 TXT、写回镜头。

设计点：
  - **生成会真实调用文字大模型**，因此 `/generate` 与 `/save-to-shot` 都是显式动作，
    不会在别的端点里被顺带触发。
  - 错误诊断走 ``meta`` 而不是 ``detail``：本项目有全局异常处理器，会把
    ``HTTPException.detail`` 拍平成一整行字符串，结构化诊断塞进 detail 会丢结构
    （这是上一轮在巨日禄导入上踩到的坑，这里直接按正确姿势写）。
  - 交付文本口径见 ``app.services.skills.quick_skill_text``。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.common import ApiResponse, success_response
from app.services.skills import quick_skill_service as svc
from app.services.skills import quick_skill_text as text_util

router = APIRouter()


# ---------------------------------------------------------------------------
# 读模型
# ---------------------------------------------------------------------------


class QuickSkillItem(BaseModel):
    """一个导演 Skill 的目录项。"""

    skill_id: str
    display_name: str
    stage: str = Field(description="image / video / hybrid")
    stage_label: str
    summary: str
    pinned: bool = Field(description="是否高频 Skill")
    source_name: str
    source_present: bool = Field(description="规则文件是否就位")
    rule_chars: int = Field(description="规则正文字数")
    load_error: str = Field(default="", description="规则文件读取失败原因（正常为空）")


class QuickSkillListRead(BaseModel):
    skills: list[QuickSkillItem]
    note: str = ""


class QuickSkillContextRead(BaseModel):
    text: str = Field(description="装配好的中台上下文（给模型看的那份）")
    data: dict = Field(default_factory=dict, description="结构化上下文（给前端回显）")


class QuickSkillGenerateRequest(BaseModel):
    skill_id: str = Field(..., description="导演 Skill ID")
    request: str = Field(..., description="本次要生成什么（必填）")
    context: str = Field("", description="额外上下文（补充要求）")
    project_id: str | None = Field(None, description="项目 ID（可选，仅用于一致性校验）")
    chapter_id: str | None = Field(None, description="章节 ID（可选，用来自动装配上下文）")
    shot_id: str | None = Field(None, description="镜头 ID（可选；填了就自动带上该镜头的剧本/资产）")
    save_to_shot: bool = Field(False, description="是否把结果写进该镜头的视频提示词")
    overwrite: bool = Field(False, description="镜头已有提示词时是否覆盖")


class QuickSkillGenerateRead(BaseModel):
    skill_id: str
    skill_name: str
    stage: str
    prompt: str = Field(description="生成的成品提示词")
    request: str
    context: str = Field(description="实际送给模型的上下文（便于复核）")
    model_used: str = Field(default="", description="本次使用的文字模型")
    saved: bool = Field(False, description="是否已写进镜头")
    saved_shot_id: str | None = None
    warnings: list[str] = Field(default_factory=list)


class QuickSkillExportEntry(BaseModel):
    label: str = Field("", description="条目显示名（如 S001 / 场景A）")
    prompt: str = Field("", description="提示词正文")
    note: str = Field("", description="附注（可选）")


class QuickSkillExportRequest(BaseModel):
    skill_id: str = Field(..., description="导演 Skill ID（用于文件名与标题）")
    project_id: str = Field("", description="项目 ID（用于文件名，可空）")
    title: str = Field("", description="文档标题（可空，默认用 Skill 名）")
    entries: list[QuickSkillExportEntry] = Field(default_factory=list, description="要导出的条目")


class QuickSkillSaveRequest(BaseModel):
    shot_id: str = Field(..., description="镜头 ID")
    prompt: str = Field(..., description="要写入的提示词")
    overwrite: bool = Field(False, description="已有提示词时是否覆盖")


class QuickSkillSaveRead(BaseModel):
    saved: bool
    shot_id: str
    source: str = Field(description="写入后的来源标记")
    message: str = Field(default="")


_LIST_NOTE = (
    "Skill 规则文件放在 backend/app/resources/prompt_skills/。"
    "生成动作会真实调用默认文字模型（付费出口），只有点「生成」才会发生。"
)


def _bad_request_response(
    exc: svc.QuickSkillError, *, diagnostics: dict[str, object] | None = None
) -> JSONResponse:
    """把可预期失败整理成统一信封，诊断信息放 ``meta``。

    本项目全局异常处理器会把 ``HTTPException.detail`` 拍平成一整行字符串
    （``meta`` 恒为 None），结构化信息塞进 detail 会丢结构，所以这里直接返回
    带 ``meta`` 的 JSONResponse —— 与巨日禄导入路由保持同一姿势。
    """
    body = ApiResponse[None](
        code=status.HTTP_400_BAD_REQUEST,
        message=str(exc),
        data=None,
        meta={"diagnostics": diagnostics or {}},
    ).model_dump()
    return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content=body)


# ---------------------------------------------------------------------------
# 端点
# ---------------------------------------------------------------------------


@router.get("/skills", response_model=ApiResponse[QuickSkillListRead], summary="导演 Skill 目录")
async def list_quick_skills() -> ApiResponse[QuickSkillListRead]:
    items = [QuickSkillItem(**item) for item in svc.list_skills()]
    return success_response(QuickSkillListRead(skills=items, note=_LIST_NOTE))


@router.get(
    "/context",
    response_model=ApiResponse[QuickSkillContextRead],
    summary="装配中台上下文（只读，不调模型）",
)
async def preview_quick_skill_context(
    chapter_id: str | None = Query(None, description="章节 ID"),
    shot_id: str | None = Query(None, description="镜头 ID"),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[QuickSkillContextRead]:
    text, data = await svc.build_shot_context(db, chapter_id=chapter_id, shot_id=shot_id)
    return success_response(QuickSkillContextRead(text=text, data=data))


@router.post(
    "/generate",
    response_model=ApiResponse[QuickSkillGenerateRead],
    summary="按导演 Skill 生成提示词（会真实调用文字模型）",
)
async def generate_quick_skill(
    body: QuickSkillGenerateRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[QuickSkillGenerateRead] | JSONResponse:
    try:
        result = await svc.generate_prompt(
            db,
            skill_id=body.skill_id,
            request=body.request,
            extra_context=body.context,
            project_id=body.project_id,
            chapter_id=body.chapter_id,
            shot_id=body.shot_id,
            save_to_shot=body.save_to_shot,
            overwrite=body.overwrite,
        )
    except svc.QuickSkillError as exc:
        return _bad_request_response(
            exc, diagnostics={"skill_id": body.skill_id, "shot_id": body.shot_id}
        )
    return success_response(
        QuickSkillGenerateRead(
            skill_id=result.skill_id,
            skill_name=result.skill_name,
            stage=result.stage,
            prompt=result.prompt,
            request=result.request,
            context=result.context,
            model_used=result.model_used,
            saved=result.saved,
            saved_shot_id=result.saved_shot_id,
            warnings=result.warnings,
        )
    )


@router.post(
    "/save-to-shot",
    response_model=ApiResponse[QuickSkillSaveRead],
    summary="把提示词写进镜头（source=skill）",
)
async def save_quick_skill_to_shot(
    body: QuickSkillSaveRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[QuickSkillSaveRead] | JSONResponse:
    prompt = str(body.prompt or "").strip()
    if not prompt:
        return _bad_request_response(
            svc.QuickSkillError("提示词为空，未写入"), diagnostics={"shot_id": body.shot_id}
        )
    saved, note = await svc.save_prompt_to_shot(
        db, shot_id=body.shot_id, prompt=prompt, overwrite=body.overwrite
    )
    if saved:
        await db.commit()
    return success_response(
        QuickSkillSaveRead(
            saved=saved,
            shot_id=body.shot_id,
            source=svc.SKILL_PROMPT_SOURCE,
            message=note or ("已写入镜头视频提示词" if saved else "未写入"),
        )
    )


@router.post(
    "/export",
    summary="导出 Skill 提示词 TXT（UTF-8 BOM）",
    response_class=Response,
)
async def export_quick_skill(
    body: QuickSkillExportRequest,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """导出已生成的提示词为 TXT。

    刻意**不在这里调模型**：导出用的正文由调用方（前端）把 `/generate` 的结果传回来，
    这样"预览"和"下载"是同一份文本，也不会因为点两次下载就付两次费。
    """
    try:
        from app.services.skills import prompt_skill_registry as registry

        spec = registry.get_prompt_skill(body.skill_id)
        skill_label = f"{spec.display_name}（{spec.skill_id}）"
    except KeyError:
        skill_label = body.skill_id

    entries = [entry.model_dump() for entry in body.entries]
    text = text_util.build_skill_export_document(
        entries, skill_label=skill_label, title=body.title or skill_label
    )
    if not text:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="没有可导出的提示词正文（entries 全为空）",
        )
    filename = text_util.export_filename(body.skill_id, body.project_id)
    return Response(
        content=text_util.encode_txt_download(text),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


__all__ = ["router"]
