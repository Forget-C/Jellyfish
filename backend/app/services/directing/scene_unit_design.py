"""六岗设计到单元执行方案的组织；提交与预览均不改写场次。"""
import re
from dataclasses import asdict
from datetime import UTC
from uuid import uuid4

from sqlalchemy import select

from app.core.contracts.directing.common import Note
from app.core.contracts.directing.design_scope import resolved_design_fields
from app.core.contracts.directing.scene_unit_design import SceneUnitDesignRequest, SceneUnitDesignResult, SceneUnitDesignSuggestionRead, SceneUnitDesignPreview
from app.core.integrations.video_capabilities import resolve_video_capability, validate_video_options
from app.core.contracts.video_generation import VideoGenerationInput
from app.models.llm import ModelCategoryKey, Provider
from app.models.task import Task
from app.services.directing.production import ProductionService
from app.services.directing.scene_design import SceneDesignService
from app.services.directing.store import RevisionConflict
from app.services.llm.provider_resolver import resolve_provider_config_from_provider
from app.services.llm.resolver import get_model_by_category
from app.services.task_service import TaskService


def unit_design_inputs(content, shot_id):
    """投影全部明确适用于目标镜头的候选与共享规则，不依赖已有单元选择。"""
    shot = next((row for row in content.design.direction.shots if row.id == shot_id), None)
    if shot is None:
        raise ValueError('请选择当前设计中有效的镜头')
    fields = [row for row in resolved_design_fields(content.design)
              if row.has_content and (row.scope in {'scene', 'scene_rule'} or shot_id in row.shot_ids
                  or any(target.unit_id == unit.id and target.coverage_item_id == item.id
                         for target in row.occurrences for unit in content.units for item in unit.coverage
                         if item.shot_id == shot_id))]
    owners = {row.owner for row in fields}
    design = content.design
    context = {'participants': [row.model_dump(mode='json') for row in design.participants
                                if row.id in (shot.participant_ids or [])]}
    for name, prefix, rows in (
        ('beats', 'beat', design.direction.beats), ('events', 'event', design.events),
        ('performance_actions', 'performance', design.performance.beats),
        ('activities', 'activity', design.staging.activities), ('continuity', 'continuity', design.continuity),
        ('blocking_states', 'blocking', design.direction.blocking_states),
        ('anchors', 'anchor', design.direction.anchors), ('cinematography', 'camera', design.cinematography),
    ):
        context[name] = [row.model_dump(mode='json') for row in rows if f'{prefix}:{row.id}' in owners]
    return {'basis': content.basis.model_dump(mode='json'), 'shot': shot.model_dump(mode='json'),
        'context': context, 'style_revision_id': content.design.style_revision_id,
        'output_aspect_ratio': content.output_aspect_ratio,
        'fields': [{**{key: getattr(row, key) for key in ('owner', 'field', 'purpose', 'scope', 'phase', 'condition')},
                    'text': row.value.text if isinstance(row.value, Note) else row.value} for row in fields],
        'units': [unit.model_dump(mode='json') for unit in content.units
                  if any(item.shot_id == shot_id for item in unit.coverage)]}


def validate_unit_design(args, result):
    """整体拒绝身份、选择、参数或自由执行文本越界；不裁剪模型输出。"""
    if result.shot_id != args['shot_id'] or result.target_model_id != args['target_model_id']:
        raise ValueError('单元方案更改了目标镜头或视频模型')
    fields = args['organization_inputs']['fields']
    allowed = {owner: {row['owner'].split(':', 1)[1] for row in fields
                        if row['owner'].startswith(owner + ':') and row['purpose'] == 'design'}
               for owner in ('beat', 'event', 'performance', 'activity', 'continuity')}
    original_units = args['organization_inputs']['units']
    protected_ids = set(args.get('protected_unit_ids', []))
    if any(unit.id in protected_ids for unit in result.units):
        raise ValueError('单元方案使用了其他镜头或跨镜头单元身份')
    texts = [row['text'] for row in fields if row['purpose'] == 'design' and row['text']]
    old_ids = {unit['id'] for unit in original_units}
    for unit in result.units:
        if len(unit.coverage) != 1:
            raise ValueError('当前视频执行器仅支持每个单元一个覆盖项；请组织为多个独立单元')
        if unit.id in old_ids and any(item['shot_id'] != args['shot_id']
                                      for old in original_units if old['id'] == unit.id for item in old['coverage']):
            raise ValueError('不能重写跨镜头既有单元')
        for state in (unit.entry_state, unit.exit_state):
            segments = [part.strip() for part in re.split(r'[；;\n]+', state) if part.strip()]
            if any(not any(segment in row['text'] for row in fields if row['text']) for segment in segments):
                raise ValueError('进入与结束状态必须取自已有适用设计；未知状态请留空并列缺项')
        for item in unit.coverage:
            if item.shot_id != args['shot_id'] or not item.action_scope.strip():
                raise ValueError('单元覆盖必须限定当前镜头并明确执行范围')
            for key, owner in (('beat_ids', 'beat'), ('event_ids', 'event'),
                               ('performance_action_ids', 'performance'), ('staging_activity_ids', 'activity'),
                               ('continuity_change_ids', 'continuity')):
                if not set(getattr(item, key)) <= allowed[owner]:
                    raise ValueError('单元选择了不存在或不适用的设计项：' + key)
            # 可执行自由文本只接受既有设计的摘录；创作变化回导演画布处理。
            segments = [part.strip() for part in re.split(r'[；;\n]+', item.action_scope) if part.strip()]
            if not segments or not all(any(segment in text for text in texts) for segment in segments):
                raise ValueError('执行范围必须摘录已有适用设计；新增创作请先修改导演设计')
        if unit.duration_ms is not None:
            if args['capabilities']['max_seconds'] is None:
                raise ValueError('目标模型时长上限未核实，不能填写确定时长')
            if unit.duration_ms % 1000:
                raise ValueError('单元预计时长必须使用整秒')
            validate_video_options(provider=args['video_provider'], model=args['target_model_name'],
                                   input_=VideoGenerationInput(prompt='单元组织参数校验', ratio=unit.ratio, seconds=unit.duration_ms // 1000))
        elif '预计时长待确定' not in unit.missing:
            unit.missing.append('预计时长待确定')
        if unit.ratio not in args['capabilities']['allowed_ratios']:
            raise ValueError('单元画幅不在目标视频模型已核实能力内')
        for requirement in unit.reference_requirements:
            missing = '参考待绑定：' + requirement
            if missing not in unit.missing:
                unit.missing.append(missing)
    shot_text = args['organization_inputs']['shot']['visible_result'].get('text') or ''
    scopes = [item.action_scope for unit in result.units for item in unit.coverage]
    if any(not any(part.strip() in scope for scope in scopes)
           for part in re.split(r'[；;\n]+', shot_text) if part.strip()):
        missing = '镜头可见结果尚有未安排内容，请核对完整覆盖'
        if missing not in result.missing:
            result.missing.append(missing)
    selected = {f'{owner}:{identity}' for unit in result.units for item in unit.coverage
                for key, owner in (('beat_ids', 'beat'), ('event_ids', 'event'),
                                   ('performance_action_ids', 'performance'), ('staging_activity_ids', 'activity'),
                                   ('continuity_change_ids', 'continuity')) for identity in getattr(item, key)}
    for row in fields:
        if row['purpose'] == 'design' and row['text'] and not row['owner'].startswith('shot:') and row['owner'] not in selected:
            missing = f"尚未安排：{row['owner']}.{row['field']}"
            if missing not in result.missing:
                result.missing.append(missing)
    return result


class SceneUnitDesignService(SceneDesignService):
    """复用场次归属、内容校验和统一任务；只读结果与正式单元隔离。"""

    async def _video(self, model_id):
        """按明确模型读取供应商真实能力；不从列表或全局设置猜测模型。"""
        model = await get_model_by_category(self.db, ModelCategoryKey.video, model_or_id=model_id)
        provider = await self.db.get(Provider, model.provider_id)
        config = resolve_provider_config_from_provider(provider=provider, category=ModelCategoryKey.video)
        capability = resolve_video_capability(provider=config.provider_key, model=model.name)
        if not capability.allowed_ratios:
            raise ValueError('目标视频模型的画幅能力尚未核实')
        references = await ProductionService(self.db, self.project_id).reference_capabilities(model.id)
        values = asdict(capability)
        values['allowed_ratios'] = sorted(capability.allowed_ratios)
        values['references'] = references.model_dump(mode='json')
        return model, config.provider_key, values

    async def submit_unit_design(self, sequence_id, version_id, body: SceneUnitDesignRequest):
        """请求身份限定固定输入；未知响应通过同身份重查，不再创建任务。"""
        sequence, current = await self._version(sequence_id, version_id)
        tasks = list(await self._tasks(sequence_id, version_id))
        existing = next((task for task in tasks if task.input_snapshot['scene_unit_design']['request']['request_id'] == body.request_id), None)
        if existing:
            if SceneUnitDesignRequest.model_validate(existing.input_snapshot['scene_unit_design']['request']) != body:
                raise RevisionConflict('AI 请求身份已用于另一份内容')
            return existing
        if any(task.status not in {'succeeded', 'failed', 'cancelled'} for task in tasks):
            raise RevisionConflict('本版本已有单元设计任务，请先核实原请求或等待完成')
        if current.revision != body.expected_revision:
            raise RevisionConflict('场次版本已变化，请重新核对')
        files = await self._validate_content(sequence, version_id, body.content)
        inputs = unit_design_inputs(body.content, body.shot_id)
        video, video_provider, capabilities = await self._video(body.target_model_id)
        model = await get_model_by_category(self.db, ModelCategoryKey.text, model_or_id=body.model_id)
        provider = await self.db.get(Provider, model.provider_id)
        config = resolve_provider_config_from_provider(provider=provider, category=ModelCategoryKey.text)
        rules = await self.applicable_style(body.content.design.style_revision_id, sequence_id, video.name)
        args = {'task_identity': uuid4().hex, 'style_rules': [rule.model_dump(mode='json') for rule in rules], 'shot_id': body.shot_id, 'target_model_id': video.id, 'target_model_name': video.name,
            'video_provider': video_provider, 'capabilities': capabilities,
            'organization_inputs': inputs, 'instruction': body.instruction,
            'protected_unit_ids': [unit.id for unit in body.content.units if any(item.shot_id != body.shot_id for item in unit.coverage)]}
        return await TaskService(self.db).submit(kind='directing_unit_design', title='AI 设计 · 单元方案',
            target_type='directing_sequence', target_id=sequence_id, project_id=self.project_id, provider_id=provider.id,
            inputs=[('unit-design-source', index, identity) for index, identity in enumerate(sorted(files))],
            snapshot={'scene_unit_design': {'version_id': version_id, 'request': body.model_dump(mode='json')},
                      'model_id': model.id, 'model_name': model.name, 'provider_key': config.provider_key, 'run_args': args})

    async def _tasks(self, sequence_id, version_id):
        return await self.db.scalars(select(Task).where(Task.project_id == self.project_id,
            Task.target_id == sequence_id, Task.kind == 'directing_unit_design',
            Task.input_snapshot['scene_unit_design']['version_id'].as_string() == version_id)
            .order_by(Task.created_at.desc(), Task.id.desc()))

    async def list_unit_design(self, sequence_id, version_id):
        """按项目、场次和版本列出固定任务；结果读取仍校验完整结构与范围。"""
        await self.read_scene_version(sequence_id, version_id)
        result = []
        for task in await self._tasks(sequence_id, version_id):
            args = task.input_snapshot['run_args']
            result.append(SceneUnitDesignSuggestionRead(task_id=task.id,
                request_id=task.input_snapshot['scene_unit_design']['request']['request_id'],
                created_at=task.created_at.replace(tzinfo=UTC), status=task.status, error=task.error_message,
                request=task.input_snapshot['scene_unit_design']['request'], target_model_name=args['target_model_name'],
                text_model_name=task.input_snapshot['model_name'], capabilities=args['capabilities'],
                result=validate_unit_design(args, SceneUnitDesignResult.model_validate(task.result)) if task.status == 'succeeded' else None))
        return result

    async def preview_unit_design(self, sequence_id, version_id, task_id, content):
        """预览核对固定输入和当前适用内容，不写入正式单元或媒体事实。"""
        sequence, _ = await self._version(sequence_id, version_id)
        task = next((row for row in await self._tasks(sequence_id, version_id) if row.id == task_id), None)
        if task is None or task.status != 'succeeded':
            raise ValueError('建议不属于当前版本或尚未成功完成')
        request = SceneUnitDesignRequest.model_validate(task.input_snapshot['scene_unit_design']['request'])
        if unit_design_inputs(content, request.shot_id) != task.input_snapshot['run_args']['organization_inputs']:
            raise RevisionConflict('相关镜头、设计或单元输入已变化，请重新 AI 设计')
        await self._validate_content(sequence, version_id, content)
        video, provider, capabilities = await self._video(request.target_model_id)
        rules = await self.applicable_style(content.design.style_revision_id, sequence_id, video.name)
        if ([rule.model_dump(mode='json') for rule in rules] != task.input_snapshot['run_args']['style_rules']
                or provider != task.input_snapshot['run_args']['video_provider']
                or video.name != task.input_snapshot['run_args']['target_model_name']
                or capabilities != task.input_snapshot['run_args']['capabilities']):
            raise RevisionConflict('目标视频模型能力已变化，请重新 AI 设计')
        return SceneUnitDesignPreview(task_id=task.id, result=validate_unit_design(task.input_snapshot['run_args'], SceneUnitDesignResult.model_validate(task.result)))
