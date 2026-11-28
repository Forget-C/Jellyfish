"""画布固定依据：纯编译、公开投影及固定快照，不读取可变配置或推进任务。"""
from dataclasses import dataclass, field
import hashlib
import json
from fastapi import HTTPException
from app.core.contracts.generation_canvas import DesignTextPayload, InputBinding
from app.core.contracts.generation import FrozenGenerationConfig, ImageGenerationOperationInput, VideoGenerationOperationInput
from app.core.contracts.media import ImageMediaInput, MediaReference
from app.core.integrations.media_validation import validate_media_parameters
from app.schemas.generation_canvas import (
    CanvasCompiledInput, CanvasDiagnostic, CanvasDocument, CanvasModelCapability,
    CanvasResolvedOutput, ModelCard,
)
from app.services.generation_canvas.compiler import compile_card, prompt_references
from app.services.generation_canvas.output_resolution import CanvasOutputContext


def digest(value) -> str:
    """规范化 JSON 摘要用于依据比较及原请求核实。"""
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def _public_parameters(value):
    if isinstance(value, dict):
        sensitive = {'api_key', 'api_secret', 'openai_api_key', 'authorization', 'password', 'access_token'}
        return {key: _public_parameters(item) for key, item in value.items() if key.lower() not in sensitive}
    if isinstance(value, list):
        return [_public_parameters(item) for item in value]
    return value


@dataclass
class CanvasModelContext:
    """运行边界已读取的数据；模型存在但配置不可用时仍保留公开模型信息。

    model 只含 id/name/params。配置沿用持久 JSON，FrozenGenerationConfig 的校验
    仍在通用 Gate 发生，避免预检或历史恢复提前增加校验、改变诊断。
    """
    model: dict | None = field(default=None, repr=False)
    execution_config: dict | None = field(default=None, repr=False)
    capability: CanvasModelCapability | None = None
    diagnostics: list[CanvasDiagnostic] = field(default_factory=list)


@dataclass
class CanvasBasis:
    """编译与公开依据；私有数据仅经 to_snapshot 显式持久化，不作为公开 DTO。"""
    card: ModelCard
    compiled: CanvasCompiledInput
    public_basis: dict
    basis_hash: str
    _document: CanvasDocument = field(repr=False)
    _outputs: dict[str, list[CanvasResolvedOutput]] = field(repr=False)
    _model_context: CanvasModelContext = field(repr=False)
    _include_acceptance: bool = field(default=True, repr=False)
    _include_dependencies: bool = field(default=True, repr=False)

    @property
    def capability(self) -> CanvasModelCapability | None:
        """供检查和预览复用已解析的公开能力。"""
        return self._model_context.capability

    def adopted_design_bindings(self) -> dict[str, list[InputBinding]]:
        """Stable direct relations of available designs included in the compiled input."""
        used_ids = {item.source.card_id for item in self.compiled.used
                    if item.available and isinstance(item.payload, DesignTextPayload)}
        return {card.id: card.input_bindings for card in self._document.cards if card.id in used_ids}

    def observed_model_inputs(self) -> list[str]:
        """Identify adopted model outputs, including ones that have yet to be published."""
        from app.services.generation_canvas.design_dependencies import dependency_sources
        cards = {card.id: card for card in self._document.cards}
        pending = [reference.source.card_id for reference, _ in prompt_references(self.card)]
        seen, observed = set(), set()
        while pending:
            card_id = pending.pop()
            if card_id in seen or card_id not in cards:
                continue
            seen.add(card_id)
            source = cards[card_id]
            if isinstance(source, ModelCard):
                observed.add(card_id)
            else:
                pending.extend(ref.card_id for ref in dependency_sources(source, self._document.id))
        return sorted(observed)

    def to_snapshot(self) -> dict:
        """固定直接来源及所采用设计的有效字段来源，不遍历任意祖先。"""
        used_sources = {ref.source.card_id for ref, _ in prompt_references(self.card)}
        used_sources.update(item.source.card_id for item in self.compiled.used)
        from app.services.generation_canvas.design_references import effective_design_references
        cards = {card.id: card for card in self._document.cards}
        for source_id in tuple(used_sources):
            if source_id in cards:
                used_sources.update(ref.source.card_id for ref, _, _ in effective_design_references(cards[source_id], cards))
        context = self._model_context
        return {'document': self._document.model_dump(), 'revision': self.compiled.revision,
            'include_acceptance': self._include_acceptance,
            'include_dependencies': self._include_dependencies,
            'outputs': {key: [item.model_dump() for item in values] for key, values in self._outputs.items() if key in used_sources},
            'execution_config': context.execution_config,
            'capability': context.capability.model_dump() if context.execution_config and context.capability else None}


def build_basis(document: CanvasDocument, card_id: str, outputs: dict[str, list[CanvasResolvedOutput]],
                *, revision: int, model_context: CanvasModelContext, context: CanvasOutputContext | None = None,
                include_acceptance: bool = True, include_dependencies: bool = True) -> CanvasBasis:
    """使用已取得的配置编译，并以同一输入产生公开依据和私有配置参与的哈希。"""
    context = context or CanvasOutputContext(document, whole_designs=include_dependencies)
    card = context.cards.get(card_id)
    if not isinstance(card, ModelCard):
        raise HTTPException(404, 'Model card not found')
    compiled = compile_card(document, card_id, model_outputs=outputs, capability=model_context.capability, context=context, include_acceptance=include_acceptance, include_dependencies=include_dependencies)
    compiled.revision = revision
    issues = list(model_context.diagnostics)
    if not compiled.text.strip() and not (card.type == 'model.video' and compiled.media):
        issues.append(CanvasDiagnostic(code='TEXT_REQUIRED', message='请提供非空文本输入', target={'card_id': card_id, 'path': ['prompt']}, blocks=['run']))
    if any(not item.basis_current for item in compiled.used):
        issues.append(CanvasDiagnostic(code="INPUT_STALE", message="实际引用的模型输出依据已变，请先执行来源",
            target={"card_id": card_id}, blocks=["run"]))
    config = model_context.execution_config
    if compiled.can_run and config and card.type in ('model.image', 'model.video') and (
        compiled.text.strip() or (card.type == 'model.video' and compiled.media)
    ):
        try:
            if card.type == 'model.video':
                operation = VideoGenerationOperationInput(**card.config.model_dump())
                media = compiled.video_media
            else:
                operation = ImageGenerationOperationInput(**card.config.model_dump())
                media = ImageMediaInput(references=[MediaReference(file_id=item.file_id, media_kind='image', ordinal=index)
                                                    for index, item in enumerate(compiled.media)])
            validate_media_parameters(FrozenGenerationConfig.model_validate(config), operation, media, compiled.text)
        except ValueError as exc:
            issues.append(CanvasDiagnostic(code='INVALID_PARAMETER', message=str(exc),
                                           target={'card_id': card_id, 'path': ['config']}, blocks=['run']))
    compiled.diagnostics += issues
    compiled.can_run = compiled.can_run and not issues
    model = model_context.model
    public = {'card': card.model_dump(exclude={'show_result_cards', 'detached_results'}), 'input': compiled.model_dump(exclude={'revision', 'diagnostics', 'can_run'}),
              'model': {'id': model['id'], 'name': model['name'], 'params': _public_parameters(model['params']) if card.type == 'model.text' else card.config.model_dump()} if model else {}}
    # 展示代号、片段 ID、传输 payload 不改变实际请求或既有成果的依据哈希。
    actual = {'card_id': card.id, 'type': card.type, 'model_id': card.model_id,
              'config': card.config.model_dump(), 'text': compiled.text,
              'used': [item.model_dump(exclude={'token', 'basis_current', 'payload'}) for item in compiled.used],
              'media': [item.model_dump(exclude={'token', 'basis_current', 'payload'}) for item in compiled.media]}
    targets = [{'source': item.source.model_dump(), 'state': item.payload.frame_target_state.model_dump(exclude={'label'})}
               for item in compiled.used if getattr(item.payload, 'frame_target_state', None)]
    if targets:
        actual['design_frame_targets'] = targets
    if card.type == 'model.video':
        actual['video_media'] = compiled.video_media.model_dump()
    return CanvasBasis(card, compiled, public, digest({'basis': actual, 'execution': model_context.execution_config}),
                       document, outputs, model_context, include_acceptance, include_dependencies)
