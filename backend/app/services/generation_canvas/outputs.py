"""单卡输出行为：处理器没有整张画布或数据库读取能力。"""
from typing import Protocol
from app.core.contracts.generation_canvas import BasisTextOutputPayload, NamedImageObject
from app.schemas.generation_canvas import (
    VisualStyleCard, PhotographyCard, SoundDirectionCard, SpatialDirectionCard, PerformanceDirectionCard, CardDefinition, CanvasResolvedOutput, CreativeBasisCard, MediaContentCard,
    NamedImageReferenceCard, NamedImagePayload, ObjectDescriptionCard, ObjectReferencePayload, DescriptionTextPayload, ModelCard, OutputIdentity, TextContentCard, TextOutputPayload, MediaOutputPayload,
)


class CardOutputHandler(Protocol):
    """仅从本卡和明确传入的数据形成出口，不提交模型任务。"""
    def publish(self, canvas_id: str, card: CardDefinition,
                adopted_inputs: tuple[CanvasResolvedOutput, ...],
                published_results: tuple[CanvasResolvedOutput, ...]) -> list[CanvasResolvedOutput]:
        """返回本卡声明的输出；无内容时不虚构未来结果。"""


class ContentOutputHandler:
    """普通内容只发布自己的正文或具体文件。"""
    def publish(self, canvas_id, card, adopted_inputs, published_results):
        """内容卡没有持续输入，描述来源只随明确描述出口提供。"""
        from app.schemas.generation_canvas import NarrativeDirectionCard, GuidanceDirectionCard
        if isinstance(card, VisualStyleCard):
            from app.services.generation_canvas.visual_style import publish_style
            return publish_style(canvas_id, card)
        if isinstance(card, GuidanceDirectionCard):
            from app.services.generation_canvas.guidance import publish_guidance
            return publish_guidance(canvas_id, card, adopted_inputs)
        from app.schemas.generation_canvas import ConstraintDirectionCard
        if isinstance(card, ConstraintDirectionCard):
            from app.services.generation_canvas.continuity import publish_constraint
            return publish_constraint(canvas_id, card, adopted_inputs)
        if isinstance(card, NarrativeDirectionCard):
            from app.services.generation_canvas.narrative import publish_narrative
            return publish_narrative(canvas_id, card, adopted_inputs)
        if isinstance(card, PhotographyCard):
            from app.services.generation_canvas.photography import publish_photography
            return publish_photography(canvas_id, card, adopted_inputs)
        if isinstance(card, SpatialDirectionCard):
            from app.services.generation_canvas.spatial import publish_spatial
            return publish_spatial(canvas_id, card, adopted_inputs)
        if isinstance(card, SoundDirectionCard):
            from app.services.generation_canvas.sound import publish_sound
            return publish_sound(canvas_id, card, adopted_inputs)
        if isinstance(card, PerformanceDirectionCard):
            from app.services.generation_canvas.performance import publish_design
            return publish_design(canvas_id, card, adopted_inputs)
        if isinstance(card, NamedImageReferenceCard):
            # 图外围控制名称就绪；保存校验仍需核对草稿的稳定身份。
            obj = NamedImageObject(object_id=card.name_binding.object_id if card.name_binding else card.object_id or card.id, name=card.name.strip(), category=card.type.split('.')[1])
            outputs = [CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id,
                port_id='object', position=0, object_id=obj.object_id), modality='text',
                payload=ObjectReferencePayload(object_id=obj.object_id, name=obj.name, category=obj.category))]
            if card.image_binding:
                image = next((item for item in published_results if item.source.port_id == 'image'), None)
                outputs.insert(0, image or CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id,
                    port_id='image', position=0), modality='image', payload=NamedImagePayload(
                    name=card.name.strip(), file_id=card.image_binding.file_id, objects=[obj], angle=card.angle)))
            return outputs
        if isinstance(card, ObjectDescriptionCard):
            outputs = []
            if card.text:
                outputs.append(CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id, port_id='text', position=0),
                    modality='text', payload=DescriptionTextPayload(text=card.text, object_id=card.object_id, name=card.name.strip(), category=card.category, source_locator=card.source_locator)))
            if card.object_id:
                outputs.append(CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id, port_id='object', position=0, object_id=card.object_id),
                    modality='text', payload=ObjectReferencePayload(object_id=card.object_id, name=card.name.strip(), category=card.category)))
            return outputs
        if isinstance(card, CreativeBasisCard):
            payload = BasisTextOutputPayload(text=card.text, source_locator=card.source_locator, selection_start=card.selection_start, selection_end=card.selection_end) if card.text else None
            port = 'text'
        elif isinstance(card, TextContentCard):
            payload = TextOutputPayload(text=card.text) if card.text else None
            port = 'text'
        elif isinstance(card, MediaContentCard):
            if published_results:
                return list(published_results)
            port = card.output_ports[0]
            if card.file_id and card.uploading:
                return [CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id,
                    port_id=port, position=0), modality=port, available=False)]
            payload = MediaOutputPayload(kind=port, file_id=card.file_id) if card.file_id and not card.uploading else None
        else:
            return []
        if payload is None:
            return []
        return [CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id, port_id=port, position=0),
                                     modality=port, payload=payload, text=getattr(payload, 'text', None),
                                     file_id=getattr(payload, 'file_id', None))]


class ModelOutputHandler:
    """模型只发布运行层明确提供的既有成果。"""
    def publish(self, canvas_id, card, adopted_inputs, published_results):
        """不给候选或输入集合增加输出资格。"""
        del adopted_inputs
        return [item for item in published_results if item.source.canvas_id == canvas_id and item.source.card_id == card.id]


def card_outputs(canvas_id: str, card: CardDefinition,
                 adopted_inputs: tuple[CanvasResolvedOutput, ...] = (),
                 published_results: tuple[CanvasResolvedOutput, ...] = ()) -> list[CanvasResolvedOutput]:
    """外围模块解析图与合法性后，仅将明确数据交给单卡处理器。"""
    handler: CardOutputHandler = ModelOutputHandler() if isinstance(card, ModelCard) else ContentOutputHandler()
    return handler.publish(canvas_id, card, adopted_inputs, published_results)
