"""画布固定依据：纯编译、公开投影及旧格式快照恢复，不读取可变配置或推进任务。"""
from dataclasses import dataclass, field
import hashlib
import json
from fastapi import HTTPException
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


def _model_card(document, card_id) -> ModelCard:
    card = next((card for card in document.cards if card.id == card_id), None)
    if not isinstance(card, ModelCard):
        raise HTTPException(404, 'Model card not found')
    return card


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
    compiled.diagnostics += issues
    compiled.can_run = compiled.can_run and not issues
    model = model_context.model
    public = {'card': card.model_dump(exclude={'show_result_cards'}), 'input': compiled.model_dump(exclude={'revision', 'diagnostics', 'can_run'}),
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


def restore_basis(snapshot: dict, card_id: str, dependency_outputs: dict[str, list[dict]]) -> CanvasBasis:
    """按旧格式恢复已受理依据；依赖须已由调用方确认成功，整组替换且不回退旧位置。"""
    from app.services.generation_canvas.snapshot_support import require_supported_snapshot
    require_supported_snapshot(snapshot)
    outputs = {key: [CanvasResolvedOutput.model_validate(item) for item in values] for key, values in snapshot['outputs'].items()}
    for source in snapshot['dependencies']:
        outputs[source] = [CanvasResolvedOutput.model_validate(item) for item in dependency_outputs[source]]
    document = CanvasDocument.model_validate(snapshot['document'])
    card = _model_card(document, card_id)
    frozen = snapshot['execution_config']
    context = CanvasModelContext(
        model={'id': card.model_id, 'name': frozen['model_name'], 'params': frozen['model_params']},
        execution_config={'model_name': frozen['model_name'], 'model_params': frozen['model_params'] or {},
            'provider_key': frozen['provider_key'], 'provider_id': frozen['provider_id'],
            'api_key': frozen['api_key'], 'base_url': frozen['base_url']},
        capability=CanvasModelCapability.model_validate(snapshot['capability']))
    return build_basis(document, card_id, outputs, revision=snapshot['revision'], model_context=context,
                       include_acceptance=snapshot.get('include_acceptance', False), include_dependencies=snapshot.get('include_dependencies', False))
