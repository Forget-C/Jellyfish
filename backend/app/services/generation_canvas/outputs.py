"""单卡输出行为：处理器没有整张画布或数据库读取能力。"""
from typing import Protocol
from app.schemas.generation_canvas import (
    CardDefinition, CanvasResolvedOutput, CreativeBasisCard, MediaContentCard,
    ObjectDescriptionCard, ObjectReferencePayload, DescriptionTextPayload, ModelCard, OutputIdentity, TextContentCard, TextOutputPayload, MediaOutputPayload,
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
        del adopted_inputs
        if isinstance(card, ObjectDescriptionCard):
            outputs = []
            if card.text:
                outputs.append(CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id, port_id='text', position=0),
                    modality='text', payload=DescriptionTextPayload(text=card.text, object_id=card.object_id, name=card.name.strip(), category=card.category, source_locator=card.source_locator)))
            if card.object_id and card.name.strip():
                outputs.append(CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas_id, card_id=card.id, port_id='object', position=0),
                    modality='text', payload=ObjectReferencePayload(object_id=card.object_id, name=card.name.strip(), category=card.category)))
            return outputs
        if isinstance(card, (TextContentCard, CreativeBasisCard)):
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
