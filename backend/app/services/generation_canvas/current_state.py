"""当前输出与依据查询；沿用调用方事务，不缓存动态结果或推进任务。"""
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.generation_canvas import CanvasCurrentOutput, CanvasResultSet
from app.models.llm import Model, ModelCategoryKey, Provider
from app.schemas.generation_canvas import CanvasDocument, CanvasDiagnostic, CanvasResolvedOutput, MediaContentCard, ModelCard, OutputIdentity
from app.services.generation_canvas.capabilities import model_capability
from app.services.generation_canvas.execution_basis import CanvasModelContext, build_basis
from app.services.generation_canvas.output_resolution import CanvasOutputContext
from app.services.llm.provider_resolver import resolve_provider_config_from_provider


class CanvasCurrentState:
    """接收已核实归属的画布；只保存会话与项目，结构上下文可复用，查询结果每次重算。"""
    def __init__(self, db: AsyncSession, project_id: str | None):
        self.db, self.project_id = db, project_id or None

    async def current_basis(self, canvas, card_id, outputs, *, lock_config=False, context=None):
        """读取当前配置及原有锁，再交给纯依据模块；已受理恢复不经过此入口。"""
        context = context or CanvasOutputContext(CanvasDocument.model_validate(canvas.document))
        document = context.document
        from app.services.generation_canvas.allowed_cards import validate_canvas_cards
        validate_canvas_cards(canvas, document)
        card = context.cards.get(card_id)
        if not isinstance(card, ModelCard):
            raise HTTPException(404, 'Model card not found')
        cap = None
        model, provider, config = None, None, None
        issues = []
        category = ModelCategoryKey(card.type.removeprefix('model.'))
        if card.model_id:
            try:
                model = await self.db.get(Model, card.model_id, with_for_update=lock_config, populate_existing=True)
                if model is None or model.category != category:
                    raise HTTPException(422, 'model_unavailable')
                provider = await self.db.get(Provider, model.provider_id, with_for_update=lock_config, populate_existing=True)
                if provider is None:
                    raise HTTPException(422, 'provider_unavailable')
                config = resolve_provider_config_from_provider(provider=provider, category=category)
                cap = await model_capability(self.db, card.model_id)
            except HTTPException:
                issues.append(CanvasDiagnostic(code='MODEL_UNAVAILABLE', message='所选模型或供应商不可用', target={'card_id': card_id, 'path': ['model_id']}, blocks=['run']))
        else:
            issues.append(CanvasDiagnostic(code='MODEL_REQUIRED', message='请选择模型', target={'card_id': card_id, 'path': ['model_id']}, blocks=['run']))
        frozen = None
        if config and model and provider:
            frozen = {'model_name': model.name, 'model_params': model.params or {}, 'provider_key': config.provider_key,
                      'provider_id': provider.id, 'api_key': config.api_key, 'base_url': config.base_url}
            if model.capability_profile and category in (ModelCategoryKey.image, ModelCategoryKey.video):
                frozen['capability_profile'] = model.capability_profile
        model_context = CanvasModelContext(
            model={'id': model.id, 'name': model.name, 'params': model.params} if model else None,
            execution_config=frozen, capability=cap, diagnostics=issues)
        return build_basis(document, card_id, outputs, revision=canvas.revision, model_context=model_context, context=context)

    async def current_outputs(self, canvas, *, context=None) -> dict[str, list[CanvasResolvedOutput]]:
        """保留当前正式结果指向，同时递归标明依据是否仍有效。"""
        rows = list((await self.db.execute(select(CanvasCurrentOutput, CanvasResultSet).join(
            CanvasResultSet, CanvasCurrentOutput.result_set_id == CanvasResultSet.id).where(
            CanvasCurrentOutput.canvas_id == canvas.id))).all())
        stored = {pointer.card_id: result for pointer, result in rows}
        result, visiting = {}, set()
        context = context or CanvasOutputContext(CanvasDocument.model_validate(canvas.document))
        document = context.document
        from app.services.generation_canvas.allowed_cards import validate_canvas_cards
        validate_canvas_cards(canvas, document)
        cards = context.cards
        from app.services.generation_canvas.scene_object_sources import current_scene_images
        result.update(await current_scene_images(self.db, self.project_id, document))
        # 文件可在保存后失效；读取和编译统一使用已核验的媒体出口。
        from app.services.generation_canvas.outputs import card_outputs
        from app.services.studio.files import require_available_file
        from app.models.studio import FileUsage
        from app.schemas.generation_canvas import NamedImageReferenceCard
        for card in document.cards:
            named = isinstance(card, NamedImageReferenceCard)
            file_id = card.image_binding.file_id if named and card.image_binding else card.file_id if isinstance(card, MediaContentCard) else None
            if not file_id:
                continue
            outputs = card_outputs(canvas.id, card)
            try:
                await require_available_file(self.db, file_id=file_id,
                    expected_type=card.output_ports[0], lock=False)
                belongs = await self.db.scalar(select(FileUsage.id).where(
                    FileUsage.file_id == file_id, FileUsage.project_id == self.project_id).limit(1))
                if self.project_id is not None and not belongs:
                    raise HTTPException(404, 'File not in project')
            except HTTPException:
                outputs = [CanvasResolvedOutput(source=OutputIdentity(canvas_id=canvas.id, card_id=card.id,
                    port_id=card.output_ports[0], position=0), modality=card.output_ports[0], available=False)]
                result[card.id] = outputs
            else:
                if not named:
                    result[card.id] = outputs
        async def resolve(card_id):
            if card_id in result or card_id in visiting or card_id not in stored or card_id not in cards:
                return
            visiting.add(card_id)
            for edge in context.incoming.get(card_id, ()):
                if edge.source_card in stored:
                    await resolve(edge.source_card)
            from app.services.generation_canvas.design_dependencies import dependency_sources
            from app.services.generation_canvas.output_resolution import prompt_references
            pending = [reference.source.card_id for reference, _ in prompt_references(cards[card_id])]
            seen = set()
            while pending:
                source_id = pending.pop()
                if source_id in seen or source_id not in cards:
                    continue
                seen.add(source_id)
                if source_id in stored:
                    await resolve(source_id)
                else:
                    pending.extend(source.card_id for source in dependency_sources(cards[source_id], document.id))
            basis = await self.current_basis(canvas, card_id, result, context=context)
            result[card_id] = [CanvasResolvedOutput.model_validate(item).model_copy(update={
                "basis_current": basis.compiled.can_run and basis.basis_hash == stored[card_id].basis_hash, "result_set_id": stored[card_id].id}) for item in stored[card_id].outputs]
            # 正式位置保留身份，但文件撤回后不能继续作为可用输入，也不以重跑承诺放行。
            for index, output in enumerate(result[card_id]):
                if not output.file_id:
                    continue
                try:
                    await require_available_file(self.db, file_id=output.file_id,
                        expected_type=output.modality, lock=False)
                except HTTPException:
                    result[card_id][index] = CanvasResolvedOutput(source=output.source,
                        modality=output.modality, available=False, result_set_id=output.result_set_id,
                        basis_current=output.basis_current)
            visiting.remove(card_id)
        for card_id in stored:
            await resolve(card_id)
        return result

