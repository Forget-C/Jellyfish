"""画布保存的固定媒体清单、文件校验及内容保护；不解析来源当前输出。"""
from dataclasses import dataclass
from fastapi import HTTPException
from sqlalchemy import delete, select
from app.models.studio import FileUsage
from app.schemas.generation_canvas import CanvasDocument, MediaContentCard, NamedImageReferenceCard, PerformanceDirectionCard, SoundDirectionCard
from app.services.generation_canvas.errors import diagnostic
from app.services.studio.file_usages import upsert_file_usage
from app.services.studio.files import require_available_file


@dataclass(frozen=True)
class SavedMediaReference:
    """每个持久引用位置独立保留文件、保护位置和原有文件诊断信息。"""
    file_id: str
    expected_type: str
    source_ref: str
    target: dict
    foreign_project_message: str


def collect_media_references(document: CanvasDocument) -> dict[str, list[SavedMediaReference]]:
    """按文档及示例顺序收集，不校验或去重；重复示例 ID 仍交由原业务流程判断。"""
    result = {}
    for card in document.cards:
        source_ref = f'{document.id}:{card.id}'
        refs = []
        if isinstance(card, (PerformanceDirectionCard, SoundDirectionCard)):
            refs = [SavedMediaReference(example.file_id, example.source.port_id, f'{source_ref}:{example.id}',
                {'card_id': card.id, 'path': ['examples', example.id]}, '示例文件不属于当前项目') for example in card.examples]
        if isinstance(card, NamedImageReferenceCard) and card.image_binding:
            refs.append(SavedMediaReference(card.image_binding.file_id, 'image', source_ref,
                {'card_id': card.id}, '文件不属于当前项目'))
        if isinstance(card, MediaContentCard) and card.file_id:
            refs.append(SavedMediaReference(card.file_id, card.type.split('.')[1], source_ref,
                {'card_id': card.id, 'path': ['file_id']}, '文件不属于当前项目'))
        result[card.id] = refs
    return result


async def validate_media_file(db, project_id: str, reference: SavedMediaReference) -> None:
    """在调用方原校验阶段锁定文件、核实类型及项目归属，保留原诊断。"""
    try:
        await require_available_file(db, file_id=reference.file_id, expected_type=reference.expected_type)
    except HTTPException as exc:
        raise diagnostic('INVALID_MEDIA_FILE', str(exc.detail), reference.target) from exc
    if not await db.scalar(select(FileUsage.id).where(
            FileUsage.file_id == reference.file_id, FileUsage.project_id == project_id).limit(1)):
        raise diagnostic('INVALID_MEDIA_FILE', reference.foreign_project_message, reference.target)


async def replace_canvas_content_usages(db, project_id: str, canvas_id: str,
                                       references: dict[str, list[SavedMediaReference]]) -> None:
    """全部校验成功后，在调用方事务内替换本画布保护，不提交事务或修改其他保护。"""
    await db.execute(delete(FileUsage).where(
        FileUsage.project_id == project_id, FileUsage.usage_kind == 'canvas_content',
        FileUsage.source_ref.like(f'{canvas_id}:%')))
    for refs in references.values():
        for reference in refs:
            await upsert_file_usage(db, file_id=reference.file_id, project_id=project_id,
                                    chapter_id=None, usage_kind='canvas_content', source_ref=reference.source_ref)
