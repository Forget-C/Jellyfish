"""局部修订的字段白名单、冻结输入以及可恢复采用编排。"""

from copy import deepcopy
import hashlib
import json

from fastapi import HTTPException
from sqlalchemy import select, update

from app.core.contracts.directing.common import Note, Source
from app.core.contracts.directing.design import SceneDesign
from app.core.contracts.directing.production import GenerationUnit, ProductionPlan, ReviewPacket
from app.core.contracts.directing.review_revision import (
    ReviewRevisionCandidate, ReviewRevisionRequest, ReviewRevisionApplication, RevisionDirectionOutcome,
    EditableRevisionFields, RevisionFieldChange, RevisionSummary,
)
from app.core.contracts.directing.workspace import AIRequest, ReviewRequest
from app.models.directing import Sequence
from app.models.task import Task
from app.services.directing.production import ProductionService
from app.services.directing.store import RevisionConflict
from app.services.task_service import TaskService


def problem_key(direction):
    """与浏览器 JSON.stringify 的固定问题元组一致。"""
    return json.dumps([direction['occurrence_id'], direction['role'], direction['finding_index']], ensure_ascii=False, separators=(',', ':'))


def fingerprint(value):
    """固定对象内容而非显示顺序生成可核对的输入身份。"""
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def allowed_fields(design, unit):
    """固定设计路径仅用于替换已有 Note；身份、关联、数组结构都不可修改。"""
    fields = {}
    shots = {item['shot_id'] for item in unit['coverage']}
    beats = {beat for item in unit['coverage'] for beat in item['beat_ids']}
    # 共享节拍仍被其他镜头引用，本轮不能改写其共同要求。
    beats -= {beat for shot in design['direction']['shots'] if shot['id'] not in shots for beat in shot['beat_ids']}

    def visit(value, path):
        if isinstance(value, dict):
            if 'state' in value and 'sources' in value:
                fields[path] = value
                return
            for key, child in value.items():
                visit(child, path + '/' + key)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                visit(child, path + '/' + str(index))

    for index, shot in enumerate(design['direction']['shots']):
        if shot['id'] in shots:
            visit(shot, f'/direction/shots/{index}')
    for index, beat in enumerate(design['direction']['beats']):
        if beat['id'] in beats:
            visit(beat, f'/direction/beats/{index}')
    for index, camera in enumerate(design['cinematography']):
        if camera['shot_id'] in shots:
            visit(camera, f'/cinematography/{index}')
    for index, beat in enumerate(design['performance']['beats']):
        if beat['beat_id'] in beats:
            visit(beat, f'/performance/beats/{index}')
    # 局部单元不能借修改本镜头重写其他镜头共享的提示词和声音要求。
    if shots == {shot['id'] for shot in design['direction']['shots']}:
        visit(design['prompt'], '/prompt')
        for key in ('sources', 'ambience_actions', 'music_constraints'):
            visit(design['sound'][key], '/sound/' + key)
    fields['/sound/execution'] = design['sound']['execution']
    return fields


def validate_candidate(context, raw):
    """按冻结白名单生成真实候选；拒绝伪造 before、扩展字段或遗漏方向。"""
    candidate = ReviewRevisionCandidate.model_validate(raw)
    edits = context.get('request', {}).get('edits', [])
    if len({(edit['target'], edit['path']) for edit in edits}) != len(edits):
        raise ValueError('同一字段不能重复修改')
    human_source = {'kind': 'human', 'reference': context.get('request', {}).get('request_id', context['input_identity']), 'version': '1'}
    for edit in edits:
        after = deepcopy(edit['after'])
        if isinstance(edit['before'], dict) and 'state' in edit['before'] and isinstance(after, dict):
            if after.get('state') in ('fact', 'proposal'):
                after.setdefault('sources', [])
                if not isinstance(after['sources'], list):
                    raise ValueError('Note 来源必须为列表')
                after['sources'] = [*after['sources'], human_source]
            after = Note.model_validate(after).model_dump(mode='json')
            before = Note.model_validate(edit['before']).model_dump(mode='json')
            if {**after, 'sources': before['sources']} == before:
                raise ValueError('方案包含无实际差异的修改')
        matches = [change for change in candidate.changes if change.target == edit['target'] and change.path == edit['path']]
        if matches and any(change.before != edit['before'] or change.after not in (edit['after'], after) for change in matches):
            raise ValueError('AI 修改与人工字段冲突，请重新生成')
        if matches:
            for change in matches:
                change.after = after
        else:
            candidate.changes.append(RevisionFieldChange(**{**edit, 'after': after}, reason='人工字段修改', problem_keys=[]))
    if not candidate.changes and not candidate.outcomes and candidate.summary is None:
        raise ValueError('没有可执行修改时必须说明未解决原因')
    if candidate.input_identity != context['input_identity']:
        raise ValueError('修订输入身份不匹配')
    # 声音制作方式必须由明确选择授权，不能从自由文本猜测创作意图。
    sound_directions = [direction for direction in context['directions'] if direction.get('sound_execution')]
    sound_conflict = len({direction['sound_execution'] for direction in sound_directions}) > 1
    deferred = {problem_key(direction) for direction in sound_directions} if sound_conflict else set()
    kept = []
    for change in candidate.changes:
        if change.target == 'design' and change.path == '/sound/execution' and change.before != context['design']['sound']['execution']:
            raise ValueError('修改前内容与固定输入不一致')
        sound_choice = change.target == 'design' and change.path == '/sound/execution'
        authorized = any(edit['target'] == 'design' and edit['path'] == '/sound/execution' and edit['after'] == change.after for edit in edits) or any(problem_key(direction) in change.problem_keys and direction.get('sound_execution') == change.after
                         for direction in context['directions'])
        if (sound_choice and change.after in ('generated', 'postproduction') and change.after != change.before
                and (sound_conflict or not authorized)):
            if not change.problem_keys:
                candidate.summary = RevisionSummary(status='needs_choice',
                    reason='声音制作方式需要你的明确选择；尚未修改声音安排',
                    choices=['声音由后期添加', '使用支持声音的模型同期生成'])
            deferred.update(change.problem_keys)
        else:
            kept.append(change)
    candidate.changes = kept
    if deferred:
        candidate.outcomes = [item for item in candidate.outcomes if item.problem_key not in deferred]
        candidate.outcomes.extend(RevisionDirectionOutcome(problem_key=key, status='needs_choice',
            reason='不同问题的声音制作选择冲突，请统一选择；尚未修改声音安排' if sound_conflict else '声音制作方式需要你的明确选择；尚未修改声音安排',
            choices=['声音由后期添加', '使用支持声音的模型同期生成']) for key in sorted(deferred))
        if candidate.summary and candidate.summary.status == 'planned':
            choice = candidate.outcomes[-1]
            candidate.summary = RevisionSummary(status='needs_choice', reason=choice.reason, choices=choice.choices)
    design, unit = deepcopy(context['design']), deepcopy(context['unit'])
    fields = allowed_fields(design, unit)
    problems = set(context['problem_keys'])
    seen = set()
    for change in candidate.changes:
        key = (change.target, change.path)
        if key in seen:
            raise ValueError('同一字段不能重复修改')
        seen.add(key)
        allowed = fields if change.target == 'design' else {'/duration_ms': unit['duration_ms'], '/ratio': unit['ratio']}
        if change.path not in allowed:
            raise ValueError('字段不在当前单元允许修改范围内：' + change.path)
        if change.before != allowed[change.path]:
            raise ValueError('修改前内容与固定输入不一致')
        if not set(change.problem_keys) <= problems:
            raise ValueError('修改指向不存在的检查问题')
        if isinstance(change.before, dict) and 'state' in change.before:
            note = Note.model_validate(change.after)
            change.after = note.model_dump(mode='json')
            allowed_sources = list(change.before['sources'])
            if any(edit['target'] == change.target and edit['path'] == change.path for edit in edits):
                allowed_sources.append(human_source)
            if context.get('task_identity'):
                allowed_sources.append({'kind': 'model', 'reference': context['task_identity'], 'version': '1'})
            if any(source.model_dump(mode='json') not in [Source.model_validate(item).model_dump(mode='json') for item in allowed_sources] for source in note.sources):
                raise ValueError('修订不得引入未经验证的来源')
        if (change.after == change.before or (isinstance(change.before, dict) and 'state' in change.before
                and {key: value for key, value in change.after.items() if key != 'sources'}
                == {key: value for key, value in Note.model_validate(change.before).model_dump(mode='json').items() if key != 'sources'})):
            raise ValueError('方案包含无实际差异的修改')
        target = design if change.target == 'design' else unit
        parts = change.path.strip('/').split('/')
        for part in parts[:-1]:
            target = target[int(part)] if isinstance(target, list) else target[part]
        target[parts[-1]] = change.after
    outcomes = {item.problem_key: item for item in candidate.outcomes}
    required = set() if context.get("direct_preview") else problems
    if len(outcomes) != len(candidate.outcomes) or not set(outcomes) <= problems or not required <= set(outcomes):
        raise ValueError('方向处理说明缺失或问题身份不匹配')
    for item in outcomes.values():
        if item.status == 'needs_choice' and len(item.choices) < 2:
            raise ValueError('需要选择时须给出明确选项')
        if item.status == 'planned' and not any(item.problem_key in change.problem_keys for change in candidate.changes):
            raise ValueError('拟落实方向必须关联实际修改')
    if candidate.summary:
        if candidate.summary.status == 'needs_choice' and len(candidate.summary.choices) < 2:
            raise ValueError('整体修改需要选择时须给出明确选项')
        if candidate.summary.status == 'planned' and not candidate.changes:
            raise ValueError('整体拟落实必须关联实际修改')
        if candidate.summary.status == 'unchanged' and candidate.changes:
            raise ValueError('无变化说明不能包含实际修改')
    proposed_design = SceneDesign.model_validate(design)
    proposed_unit = GenerationUnit.model_validate(unit)
    shots = {item.shot_id for item in proposed_unit.coverage}
    beats = {beat for item in proposed_unit.coverage for beat in item.beat_ids}
    required = [proposed_design.direction.viewpoint, proposed_design.direction.information_change]
    required += [shot.visible_result for shot in proposed_design.direction.shots if shot.id in shots]
    required += [beat.must_show for beat in proposed_design.direction.beats if beat.id in beats]
    if any(note.state not in ('fact', 'proposal') for note in required):
        raise ValueError('修订不能清空编译必需的视点、信息变化、可见结果或节拍内容')
    return candidate, proposed_design, proposed_unit


class ReviewRevisionService(ProductionService):
    """候选只存任务，采用通过 DirectingStore 创建隔离版本并重新审稿。"""

    async def freeze_revision_input(self, sequence_id, body, *, original_request=None):
        """检查来源与指令必须完全匹配；全量输入都纳入身份。"""
        sequence = await self.read_sequence(sequence_id)
        if sequence.source_changed:
            raise RevisionConflict('原文已变化，请更新场次后重新检查')
        prompt = await self.revision(body.prompt_revision_id, kind='prompt', sequence_id=sequence_id, confirmed=True)
        plan = await self.revision(prompt.payload['plan_revision_id'], kind='plan', sequence_id=sequence_id, confirmed=True)
        design = await self.revision(plan.payload['design_revision_id'], kind='design', sequence_id=sequence_id, confirmed=True)
        sequence_row = await self.sequence(sequence_id)
        await self._validate(sequence_row, SceneDesign.model_validate(design.payload))
        await self._validate(sequence_row, ProductionPlan.model_validate(plan.payload))
        unit = self._unit(ProductionPlan.model_validate(plan.payload), prompt.payload['unit_id'])
        packet = None
        if body.review_source is None:
            if body.directions:
                raise ValueError('主动修改不能使用检查问题方向')
        elif body.review_source.kind == 'review':
            review = await self.revision(body.review_source.id, kind='review', sequence_id=sequence_id, confirmed=True)
            packet = ReviewPacket.model_validate(review.payload)
        else:
            task = await self.db.get(Task, body.review_source.id)
            if task is None or task.kind != 'directing_review' or task.project_id != self.project_id or task.target_id != sequence_id or task.status != 'succeeded':
                raise ValueError('检查任务尚无可用的固定结果')
            packet = ReviewPacket.model_validate(task.result)
        if packet and any(item.prompt_revision_id != prompt.id for item in packet.occurrences):
            raise ValueError('检查来源不属于当前指令')
        if packet:
            await self._validate(await self.sequence(sequence_id), packet)
        keys = [problem_key({'occurrence_id': row.occurrence_id, 'role': row.role, 'finding_index': index})
                for row in (packet.rows if packet else []) if row.verdict != 'pass' for index in (range(len(row.findings)) if row.findings else [-1])]
        directions = sorted([item.model_dump(mode='json') for item in body.directions], key=problem_key)
        if len({problem_key(item) for item in directions}) != len(directions) or any(problem_key(item) not in keys for item in directions):
            raise ValueError('方向不属于固定检查问题')
        context = {'request': original_request if original_request is not None else body.model_dump(mode='json'), 'sequence': sequence.model_dump(mode='json'),
                   'design_revision_id': design.id, 'design_version': design.version, 'design': design.payload,
                   'plan_revision_id': plan.id, 'plan_version': plan.version, 'plan': plan.payload,
                   'prompt_revision_id': prompt.id, 'prompt_version': prompt.version, 'prompt': prompt.payload,
                   'unit': unit.model_dump(mode='json'), 'review': packet.model_dump(mode='json') if packet else None,
                   'directions': directions, 'problem_keys': keys}
        context['input_identity'] = fingerprint(context)
        context['allowed_design_fields'] = allowed_fields(context['design'], context['unit'])
        context['allowed_unit_fields'] = {'/duration_ms': unit.duration_ms, '/ratio': unit.ratio}
        context['design_schema'] = SceneDesign.model_json_schema()
        context['unit_schema'] = GenerationUnit.model_json_schema()
        return context

    async def generate_revision(self, sequence_id, body):
        """同一请求身份重试返回原任务，候选生成不会写入任何设计版本。"""
        await self.sequence(sequence_id)
        # SQLite 忽略 FOR UPDATE；无值变化的写锁也串行化同场次请求。
        await self.db.execute(update(Sequence).where(Sequence.id == sequence_id).values(version=Sequence.version))
        existing = await self.db.scalar(select(Task).where(Task.project_id == self.project_id, Task.target_id == sequence_id,
            Task.kind == 'directing_review_revision', Task.input_snapshot['revision_request_id'].as_string() == body.request_id))
        if existing:
            if (ReviewRevisionRequest.model_validate(existing.input_snapshot['revision_request']) != body
                    or existing.input_snapshot['run_args']['revision_context'].get('direct_preview')):
                raise RevisionConflict('生成请求身份已用于其他方向')
            return existing
        context = await self.freeze_revision_input(sequence_id, body)
        if not body.review_source and not body.instruction.strip() and not body.edits:
            raise ValueError('请填写整体修改要求或直接编辑字段')
        if body.edits:
            validate_candidate({**context, 'direct_preview': True}, {'input_identity': context['input_identity']})
        return await self.submit_ai(kind='directing_review_revision', body=AIRequest(model_id=body.model_id, instruction=body.instruction), sequence_id=sequence_id,
            extra={'revision_context': context}, request_context={'revision_request_id': body.request_id, 'revision_request': body.model_dump(mode='json')})

    async def editable_fields(self, sequence_id, prompt_revision_id):
        """读取白名单不会提交任务或派生版本。"""
        context = await self.freeze_revision_input(sequence_id, ReviewRevisionRequest(
            prompt_revision_id=prompt_revision_id, request_id='read-fields'))
        fields = [{'target': target, 'path': path, 'value': value}
                  for target in ('design', 'unit') for path, value in context['allowed_' + target + '_fields'].items()]
        return EditableRevisionFields(prompt_revision_id=prompt_revision_id, fields=fields)

    async def candidate_preview(self, sequence_id, context, raw):
        """候选内容和完整编译文本绑定身份，模型不能自报预览。"""
        candidate, design, unit = validate_candidate(context, raw)
        candidate.preview_text, _ = await self.render_unit(sequence_id, design, unit)
        candidate.source_prompt_revision_id = context['prompt_revision_id']
        candidate.candidate_identity = None
        candidate.candidate_identity = fingerprint(candidate.model_dump(mode='json', exclude={'summary'} if candidate.summary is None else set()))
        return candidate

    async def read_task(self, task_id):
        result = await super().read_task(task_id)
        if result.revision:
            task = await self.db.get(Task, task_id)
            frozen = task.input_snapshot.get('revision_preview')
            if frozen:
                result.revision = ReviewRevisionCandidate.model_validate(frozen)
            else:
                # 旧任务没有预览快照；首次可渲染时补齐，不依赖模型返回的预览字段。
                try:
                    result.revision = await self.complete_candidate(task, task.result)
                except HTTPException as error:
                    if error.status_code != 404:
                        raise
        return result

    async def complete_candidate(self, task, raw):
        """任务成功事务中保存服务端预览，历史展示不再读取可变模型配置。"""
        context = task.input_snapshot['run_args']['revision_context']
        candidate = await self.candidate_preview(task.target_id, context, raw)
        task.input_snapshot = {**task.input_snapshot, 'revision_preview': candidate.model_dump(mode='json')}
        await self.db.flush()
        return candidate

    async def preview_revision(self, sequence_id, body):
        """同步人工预览保留可恢复任务快照，绝不调用模型或保存确认版本。"""
        if not body.edits or body.instruction.strip():
            raise ValueError('直接预览须有字段修改；整体修改要求请生成 AI 方案')
        await self.sequence(sequence_id)
        await self.db.execute(update(Sequence).where(Sequence.id == sequence_id).values(version=Sequence.version))
        existing = await self.db.scalar(select(Task).where(Task.project_id == self.project_id, Task.target_id == sequence_id,
            Task.kind == 'directing_review_revision', Task.input_snapshot['revision_request_id'].as_string() == body.request_id))
        if existing:
            if ReviewRevisionRequest.model_validate(existing.input_snapshot['revision_request']) != body or not existing.input_snapshot['run_args']['revision_context'].get('direct_preview'):
                raise RevisionConflict('预览请求身份已用于其他修改')
            return existing
        context = await self.freeze_revision_input(sequence_id, body)
        context['direct_preview'] = True
        candidate = await self.candidate_preview(sequence_id, context, {'input_identity': context['input_identity']})
        tasks = TaskService(self.db)
        task = await tasks.submit(kind='directing_review_revision', title='人工修改预览', project_id=self.project_id,
            target_type='directing_sequence', target_id=sequence_id,
            snapshot={'revision_request_id': body.request_id, 'revision_request': body.model_dump(mode='json'),
                'run_args': {'revision_context': context}, 'revision_preview': candidate.model_dump(mode='json')})
        await tasks.claim(task.id, worker_id='directing-preview')
        return await tasks.finish(task.id, result=candidate.model_dump(mode='json'))

    async def apply_revision(self, sequence_id, body):
        """以任务锁串行推进步骤；每步输出和身份一起持久化，失败只回滚当前步骤。"""
        await self.sequence(sequence_id)
        async def read_application(*, locked=False):
            """恢复已完成请求只读取；待执行请求在场次写锁内重新核对身份。"""
            query = select(Task).where(Task.id == body.task_id).execution_options(populate_existing=True)
            current_task = await self.db.scalar(query.with_for_update() if locked else query)
            if current_task is None or current_task.kind != 'directing_review_revision' or current_task.project_id != self.project_id or current_task.target_id != sequence_id or current_task.status != 'succeeded':
                raise ValueError('没有可采用的修订方案')
            current_snapshot = deepcopy(current_task.input_snapshot)
            current_context = current_snapshot['run_args']['revision_context']
            directions = sorted([item.model_dump(mode='json') for item in body.directions], key=problem_key)
            if (body.input_identity != current_context['input_identity'] or directions != current_context['directions']
                    or body.instruction != current_context['request'].get('instruction', '')
                    or [edit.model_dump(mode='json') for edit in body.edits] != current_context['request'].get('edits', [])):
                raise RevisionConflict('方向或输入已变化，请重新生成方案')
            current_state = current_snapshot.get('revision_application')
            if current_state and current_state['request_id'] != body.request_id:
                raise RevisionConflict('该方案已有采用请求，请继续原请求')
            return current_task, current_snapshot, current_context, current_state

        task, snapshot, context, state = await read_application()
        if state and state.get('review_task_id') and state['stage'] == 'reviewing':
            return ReviewRevisionApplication.model_validate(state)
        await self.db.execute(update(Sequence).where(Sequence.id == sequence_id).values(version=Sequence.version))
        task, snapshot, context, state = await read_application(locked=True)
        if state and state.get('review_task_id') and state['stage'] == 'reviewing':
            return ReviewRevisionApplication.model_validate(state)
        current = await self.freeze_revision_input(sequence_id, ReviewRevisionRequest.model_validate(context['request']), original_request=context['request'])
        if current['input_identity'] != context['input_identity']:
            raise RevisionConflict('原文、检查或目标版本已变化，请重新生成方案')
        preview = await self.candidate_preview(sequence_id, context, task.result)
        if body.candidate_identity != preview.candidate_identity and (body.candidate_identity is not None or 'instruction' in context['request']):
            raise RevisionConflict('候选或预览已变化，请重新查看方案')
        candidate, design, unit = validate_candidate(context, task.result)
        if (not candidate.changes or any(item.status != 'planned' for item in candidate.outcomes)
                or (candidate.summary is not None and candidate.summary.status != 'planned')):
            raise ValueError('方案没有可执行修改、仍有必要选择或未解决问题，请调整方向后重新生成')
        state = state or {'task_id': task.id, 'request_id': body.request_id, 'stage': 'blocked'}
        state['error'] = None
        try:
            if not state.get('plan_revision_id'):
                async with self.db.begin_nested():
                    saved_design = await self.revision(context['design_revision_id'], kind='design', sequence_id=sequence_id, confirmed=True)
                    if any(change.target == 'design' for change in candidate.changes):
                        saved_design = await self.save_revision(sequence_id, kind='design', payload=design.model_dump(mode='json'), parent_id=context['design_revision_id'])
                        await self.confirm_revision(saved_design.id, expected_version=saved_design.version, actor_id='workspace-user')
                    plan = ProductionPlan(design_revision_id=saved_design.id, units=[unit])
                    saved_plan = await self.save_revision(sequence_id, kind='plan', payload=plan.model_dump(mode='json'), parent_id=context['plan_revision_id'])
                    await self.confirm_revision(saved_plan.id, expected_version=saved_plan.version, actor_id='workspace-user')
                    # 能力或参考不适用时回滚整个版本步骤，不留下永远无法编译的已确认产物。
                    await self.validate_unit(sequence_id, saved_plan.id, unit.id)
                    state.update(design_revision_id=saved_design.id, plan_revision_id=saved_plan.id, stage='saved')
            if not state.get('prompt_revision_id'):
                async with self.db.begin_nested():
                    prompt = await self.compile_unit(sequence_id, state['plan_revision_id'], unit.id, request_id='rev-compile-' + task.id)
                    if prompt.payload['text'] != preview.preview_text:
                        raise RevisionConflict('正式编译与预览不一致，请重新生成方案')
                    state.update(prompt_revision_id=prompt.id, stage='compiled')
            if not state.get('review_task_id'):
                async with self.db.begin_nested():
                    review = await self.submit_review(sequence_id, state['prompt_revision_id'], ReviewRequest(model_id=context['request']['model_id'], request_id='rev-review-' + task.id))
                    state.update(review_task_id=review.id, stage='reviewing')
        except (ValueError, HTTPException, RuntimeError, TimeoutError) as error:
            message = str(error) if isinstance(error, ValueError) else str(error.detail) if isinstance(error, HTTPException) else '处理暂时中断，请继续原请求'
            state.update(stage='blocked', error=message)
        snapshot['revision_application'] = state
        task.input_snapshot = snapshot
        await self.db.flush()
        return ReviewRevisionApplication.model_validate(state)
