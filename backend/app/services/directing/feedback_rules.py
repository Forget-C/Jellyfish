"""由 DirectingStore 调用的反馈校验，记录仍使用统一版本和引用索引。"""
from sqlalchemy import select

from app.core.contracts.directing.feedback import CutReview, KnowledgeCandidate, RepairItem
from app.core.contracts.directing.production import ProductionPlan, SequenceCut
from app.models.studio import FileUsage
from app.models.task import Task


def semantic_changes(before, after, path):
    """逐字段比较实质输入，忽略身份和来源元数据，防止一个栏目内多改被算成单变量。"""
    if isinstance(before, dict) and isinstance(after, dict):
        return [item for key in sorted(before.keys() | after.keys()) if key not in ('id', 'sources', 'source')
                for item in semantic_changes(before.get(key), after.get(key), path + '.' + key)]
    if isinstance(before, list) and isinstance(after, list) and len(before) == len(after):
        return [item for index, (left, right) in enumerate(zip(before, after))
                for item in semantic_changes(left, right, f'{path}[{index}]')]
    return [path] if before != after else []


def covers(items, take_id, interval):
    """允许保留区间在新剪辑被分成连续多项，但不能丢失任何源时间。"""
    cursor = interval.source_in_ms
    for item in sorted((item for item in items if item.kind == 'media' and item.take_id == take_id),
                       key=lambda item: item.media_range.source_in_ms):
        if item.media_range.source_in_ms > cursor:
            break
        cursor = max(cursor, item.media_range.source_out_ms)
        if cursor >= interval.source_out_ms:
            return True
    return False


async def changed_factors(store, sequence_id, repair):
    """比较实际新旧输入的语义字段；文本同步变化不额外充当一个实验变量。"""
    if not repair.result_take_id and not repair.result_plan_revision_id:
        return []
    cut = SequenceCut.model_validate((await store.revision(repair.cut_revision_id, kind='cut', sequence_id=sequence_id, confirmed=True)).payload)
    item = next((item for item in cut.items if item.id == repair.item_id and item.kind == 'media'), None)
    if item is None:
        raise ValueError('返工目标必须是原剪辑内的真实片段')
    before = await store.take(item.take_id, sequence_id=sequence_id)
    after = await store.take(repair.result_take_id, sequence_id=sequence_id) if repair.result_take_id else None
    old_plan = ProductionPlan.model_validate((await store.revision(before.plan_revision_id)).payload)
    new_plan = ProductionPlan.model_validate((await store.revision(after.plan_revision_id if after else repair.result_plan_revision_id,
        kind='plan', sequence_id=sequence_id, confirmed=True)).payload)
    old = next(unit for unit in old_plan.units if unit.id == before.unit_id)
    new = next((unit for unit in new_plan.units if unit.id == (after.unit_id if after else repair.result_unit_id)), None)
    if new is None:
        raise ValueError('结果计划不存在所选单元')
    # Stable unit/coverage/reference IDs are identities, not artistic variables.
    fields = ['model_id', 'duration_ms', 'ratio', 'references', 'dependencies', 'coverage', 'capability']
    old_data, new_data = old.model_dump(mode='json'), new.model_dump(mode='json')
    changes = [item for field in fields for item in semantic_changes(old_data[field], new_data[field], field)]
    changes.extend('parameters.' + key for key in sorted(old.parameters.keys() | new.parameters.keys())
                   if old.parameters.get(key) != new.parameters.get(key))
    old_design = (await store.revision(old_plan.design_revision_id)).payload
    new_design = (await store.revision(new_plan.design_revision_id)).payload
    changes.extend(semantic_changes(old_design, new_design, 'design'))
    if after and not changes:
        old_prompt = (await store.revision(before.prompt_revision_id)).payload['text']
        new_prompt = (await store.revision(after.prompt_revision_id)).payload['text']
        if old_prompt != new_prompt:
            changes.append('prompt.text')
    if after:
        before_task = await store.db.get(Task, before.task_id)
        after_task = await store.db.get(Task, after.task_id)
        for key in ('model_name', 'provider_key'):
            if 'model_id' not in changes and before_task.input_snapshot.get(key) != after_task.input_snapshot.get(key):
                changes.append('execution.' + key)
        before_input = before_task.input_snapshot.get('operation_input') or {}
        after_input = after_task.input_snapshot.get('operation_input') or {}
        for key, factor in [('ratio', 'ratio'), ('seconds', 'duration_ms'), ('seed', 'parameters.seed')]:
            if factor not in changes and before_input.get(key) != after_input.get(key):
                changes.append('execution.' + key)
    return changes


async def validate_feedback(store, sequence, content):
    """校验固定采用、保留区间、结果来源与归因，返回统一引用保护索引。"""
    dependencies, files, takes = set(), set(), set()

    async def take_range(take_id, interval):
        """每个区间必须指向同场次可用素材，引用保护原文件。"""
        take = await store.take(take_id, sequence_id=sequence.id)
        await store._range(take.file_id, interval)
        takes.add(take.id)
        files.add(take.file_id)
        return take

    if isinstance(content, (CutReview, RepairItem)):
        cut_row = await store.revision(content.cut_revision_id, kind='cut', sequence_id=sequence.id, confirmed=True)
        dependencies.add(cut_row.id)
        cut = SequenceCut.model_validate(cut_row.payload)
        if isinstance(content, CutReview):
            if content.verdict == 'pass' and (not cut.items or any(item.kind != 'media' for item in cut.items)):
                raise ValueError('空剪辑或预演不能验收为真实场次通过')
            for observation in content.usable_ranges + [e for issue in content.issues for e in issue.evidence]:
                await take_range(observation.take_id, observation.media_range)
                if not any(item.kind == 'media' and item.take_id == observation.take_id
                    and item.media_range.source_in_ms <= observation.media_range.source_in_ms
                    and item.media_range.source_out_ms >= observation.media_range.source_out_ms for item in cut.items):
                    raise ValueError('场次审片证据必须位于本次采用区间内')
            for issue in content.issues:
                if not issue.observation.text or not issue.observation.sources:
                    raise ValueError('问题观察必须有内容和来源')
        else:
            item = next((item for item in cut.items if item.id == content.item_id and item.kind == 'media'), None)
            if item is None:
                raise ValueError('返工目标必须是原剪辑内的真实片段')
            await take_range(item.take_id, content.problem_range)
            if not (item.media_range.source_in_ms <= content.problem_range.source_in_ms
                    < content.problem_range.source_out_ms <= item.media_range.source_out_ms):
                raise ValueError('问题区间超出采用范围')
            for retained in content.retained_ranges:
                await take_range(retained.take_id, retained.media_range)
                if not covers(cut.items, retained.take_id, retained.media_range):
                    raise ValueError('保留范围必须来自原确认采用')
                if retained.take_id == item.take_id and (retained.media_range.source_in_ms < content.problem_range.source_out_ms
                        and retained.media_range.source_out_ms > content.problem_range.source_in_ms):
                    raise ValueError('保留范围不能与同素材的问题区间重叠')
            if content.result_plan_revision_id:
                await store.revision(content.result_plan_revision_id, kind='plan', sequence_id=sequence.id, confirmed=True)
                dependencies.add(content.result_plan_revision_id)
            if content.result_take_id:
                after = await take_range(content.result_take_id, content.result_range)
                if content.result_plan_revision_id and (after.plan_revision_id != content.result_plan_revision_id or after.unit_id != content.result_unit_id):
                    raise ValueError('结果素材不属于所选返工计划单元')
            if content.result_cut_revision_id:
                result_cut = await store.revision(content.result_cut_revision_id, kind='cut', sequence_id=sequence.id, confirmed=True)
                result_items = SequenceCut.model_validate(result_cut.payload).items
                for retained in content.retained_ranges:
                    if not covers(result_items, retained.take_id, retained.media_range):
                        raise ValueError('结果剪辑未完整保留指定的好区间')
                if content.result_take_id and not covers(result_items, content.result_take_id, content.result_range):
                    raise ValueError('结果剪辑未采用所选结果素材区间')
                dependencies.add(content.result_cut_revision_id)
            factors = await changed_factors(store, sequence.id, content)
            if content.attribution == 'single_variable' and content.result_take_id:
                before_task = await store.db.get(Task, (await store.take(item.take_id)).task_id)
                after_task = await store.db.get(Task, (await store.take(content.result_take_id)).task_id)
                if any(not task.input_snapshot.get('model_name') or (task.input_snapshot.get('operation_input') or {}).get('kind') != 'video_generation'
                       for task in (before_task, after_task)):
                    raise ValueError('实际执行快照不足，不能确认单变量比较')
            if content.attribution == 'single_variable' and len(factors) != 1:
                raise ValueError('实际输入不是单变量变化，不能宣称单变量比较')
            if content.attribution == 'multiple_variables' and len(factors) < 2:
                raise ValueError('实际输入未检测到多个变化因素')
    elif isinstance(content, KnowledgeCandidate):
        for identity in content.evidence_revision_ids:
            row = await store.revision(identity, sequence_id=sequence.id, confirmed=True)
            if row.kind not in ('cut_review', 'repair', 'review'):
                raise ValueError('经验版本证据应来自审片、返工比较或审稿')
            dependencies.add(identity)
        for identity in content.evidence_take_ids:
            take = await store.take(identity, sequence_id=sequence.id)
            takes.add(take.id)
            files.add(take.file_id)
    # Feedback accepts only project-owned file evidence, including nested human/model notes.
    async def check_files(value):
        """递归保护来源文件，拒绝借助人工来源引用其他项目文件。"""
        if isinstance(value, dict):
            if value.get('file_id') and not await store.db.scalar(select(FileUsage.file_id).where(
                    FileUsage.file_id == value['file_id'], FileUsage.project_id == store.project_id)):
                raise ValueError('证据文件不属于本项目')
            for child in value.values():
                await check_files(child)
        elif isinstance(value, list):
            for child in value:
                await check_files(child)
    await check_files(content.model_dump(mode='json'))
    return dependencies, files, takes
