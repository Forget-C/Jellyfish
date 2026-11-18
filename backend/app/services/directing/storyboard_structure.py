"""Retain a failed storyboard for bounded association repair, never for direct application."""

import json
import re
from copy import deepcopy

from pydantic import ValidationError

from app.services.generation_canvas.catalog import CARD_TITLES
from app.core.contracts.directing.scene_storyboard import SceneStoryboard, StoryboardStructureOption


ASSOCIATIONS = frozenset(('object_ids', 'object_id', 'scope', 'dependencies', 'frame_target', 'frame_targets'))


def structure_content(value):
    """Association correction cannot silently rewrite creative content or identities."""
    if isinstance(value, dict):
        return {key: structure_content(item) for key, item in value.items() if key not in ASSOCIATIONS}
    if isinstance(value, list):
        return [structure_content(item) for item in value]
    return value


def retained_structure(output: str, issues: list[str]) -> dict:
    """Only a schema-readable draft can be safely resumed with stable identities."""
    try:
        draft = SceneStoryboard.model_validate_json(output).model_dump(mode='json')
    except ValueError:
        draft = None
    if any(marker in issue for issue in issues for marker in (
            '分镜出处必须', '原文事实必须', '设计字段出处不属于', '镜头身份必须唯一', '创作提议必须')):
        draft = None
    return {'output': output, 'draft': draft, 'issues': issues, 'draft_issues': issues if draft else []}



def diagnose_retained_structure(saved: dict, args: dict) -> dict:
    """Revalidate the frozen draft; execution history never grants repair permissions."""
    from app.services.directing.storyboard_assembly import validate_storyboard
    if not saved.get('draft'):
        return saved
    try:
        validate_storyboard(SceneStoryboard.model_validate(saved['draft']), args)
        issues = []
    except ValidationError as error:
        issues = [('.'.join(map(str, item['loc'])) or '工作单') + '：' + item['msg']
                  for item in error.errors(include_url=False, include_input=False, include_context=False)]
    except ValueError as error:
        issues = ['design：' + str(error)]
    return {**saved, 'issues': issues, 'draft_issues': issues}


def structure_feedback(saved: dict) -> str:
    """The model sees only draft evidence and errors, never provider configuration."""
    return ('继续修正保留草案中的对象关联、设计范围或引用错误。保留镜头数量、顺序、身份、原文事实和所有设计正文。'
            '不能为了通过校验扩大出镜对象；依据不足时保留问题，不猜测创作取舍。返回完整 JSON。\n'
            '用户纠错意见只适用于本次关联修正，不是新增原文事实。若与所选方案矛盾或超出范围，'
            '不得自行决定优先级或忽略意见，返回空 structure_choices 并用自然语言 reason 说明需要用户修改什么，使用对象名称与镜头序号，不使用内部ID和字段路径。'
            + CHOICE_INSTRUCTION
            + json.dumps({'draft': saved['draft'], 'issues': saved['issues'],
                          'selected_option': saved.get('selected_option'), 'correction_notes': saved.get('correction_notes', '')}, ensure_ascii=False))


CHOICE_INSTRUCTION = (
    '仅修正对象关联、范围和引用，不改变镜头数量、顺序、身份、事实和设计正文。'
    '若存在需要用户决定的不同合理解释，不自动取舍，可返回 {"structure_choices": '
    '[{"id":"稳定选项ID","title":"方案名称","impact":"涉及镜头及实际变化","instruction":"具体关联修正要求"}]}。'
    '只列有原文和现有设计依据的方案，最多四项，不凑选项；没有可靠方案时返回空列表，reason 必须说明缺少什么依据。'
)


def structure_choices(output: str) -> list[dict] | None:
    """Validate the alternate correction response before persisting user choices."""
    try:
        data = json.loads(output)
    except ValueError:
        return None
    if not isinstance(data, dict) or 'structure_choices' not in data:
        return None
    rows = data['structure_choices']
    if not isinstance(rows, list) or len(rows) > 4:
        raise ValueError('纠错方案格式无效')
    options = [StoryboardStructureOption.model_validate(row).model_dump(mode='json') for row in rows]
    if len({row['id'] for row in options}) != len(options):
        raise ValueError('纠错方案身份重复')
    return options


def validate_structure_repair(original: dict, updated: dict, issues: list[str], prepared: list[dict]) -> None:
    """Limit association edits to faulty designs and their actual subject gaps."""
    normalized = deepcopy(original)
    invalid_objects = set()
    sources = {(item['kind'], item['excerpt']) for item in prepared}
    for index, item in enumerate(original.get('missed_objects', [])):
        if (item['kind'], item['excerpt']) in sources and index < len(updated.get('missed_objects', [])):
            invalid_objects.add(index)
            for key in ('kind', 'name', 'excerpt'):
                normalized['missed_objects'][index][key] = updated['missed_objects'][index][key]
    if structure_content(normalized) != structure_content(updated):
        raise ValueError('结构纠错改变了镜头结构、原文事实或无关设计正文，修改未采用')
    shots = {shot['id']: shot for shot in original['shots']}
    allowed = {('missed_objects', index, key) for index in invalid_objects for key in ('kind', 'name', 'excerpt')}
    subject_gaps = {}
    rows = [(('designs', index), None, design) for index, design in enumerate(original.get('designs', []))]
    rows += [(('shots', index, 'designs', offset), shot, design)
             for index, shot in enumerate(original['shots']) for offset, design in enumerate(shot.get('designs', []))]
    for path, owner, design in rows:
        location = '.'.join(map(str, path))
        identity = f"shot:{owner['id']}:design:{design['id']}" if owner else f"scene:design:{design['id']}"
        identified = any(issue.startswith((location + '.', location + '：')) or f'设计 {identity}，' in issue for issue in issues)
        if not identified:
            continue
        allowed.update((*path, key) for key in ('object_id', 'frame_target'))
        for name, note in design.get('fields', {}).items():
            allowed.update((*path, 'fields', name, key) for key in ('scope', 'dependencies'))
            scope = note.get('scope') or {}
            targets = scope.get('shot_ids') or ([owner['id']] if owner else list(shots))
            for index, shot in enumerate(original['shots']):
                if shot['id'] in targets and design.get('object_id') not in shot.get('object_ids', []):
                    target = ('shots', index, 'object_ids')
                    allowed.add(target)
                    subject_gaps.setdefault(target, set()).add(design.get('object_id'))
    def check(before, after, path=()):
        if before == after:
            return
        if path in allowed:
            if path in subject_gaps and (set(before or []) ^ set(after or [])) - subject_gaps[path]:
                raise ValueError('结构纠错改变了无关参与对象，整批修改未采用')
            return
        if path and path[-1] in ASSOCIATIONS:
            if path not in allowed:
                raise ValueError('结构纠错修改了未涉及错误的关联，整批修改未采用')
            return
        if isinstance(before, dict) and isinstance(after, dict):
            for key in before.keys() | after.keys():
                check(before.get(key), after.get(key), (*path, key))
        elif isinstance(before, list) and isinstance(after, list) and len(before) == len(after):
            for index, (left, right) in enumerate(zip(before, after)):
                check(left, right, (*path, index))
        else:
            raise ValueError('结构纠错改变了无关内容，修改未采用')
    check(original, updated)


def user_structure_issues(saved: dict, objects: list[dict]) -> list[dict]:
    """Translate known diagnostics without exposing paths or guessing missing identities."""
    draft = saved.get('draft') or {}
    shots = draft.get('shots', [])
    names = {item['id']: item['name'] for item in objects + draft.get('missed_objects', [])}
    result = []
    seen = set()
    for issue in saved.get('issues', []):
        if issue in seen or issue == saved.get('decision_reason'):
            continue
        seen.add(issue)
        row = {'title': '待定位的问题', 'explanation': '暂时无法定位具体内容，请展开技术诊断查看原始记录。',
               'decision': '请核对原文与草案，说明处理方式；依据不足时保留问题。', 'context': ''}
        rejection_reasons = {
            '结构纠错修改了未涉及错误的关联': '纠错修改了本次问题范围之外的关联，整批修改未采用，原草案保持不变。',
            '结构纠错改变了无关参与对象': '纠错改变了本次问题范围之外的参与对象，整批修改未采用，原草案保持不变。',
            '结构纠错改变了镜头结构、原文事实或无关设计正文': '纠错改变了受保护的镜头结构、原文事实或设计正文，修改未采用，原草案保持不变。',
            '结构纠错改变了无关内容': '纠错改变了本次问题范围之外的内容，修改未采用，原草案保持不变。',
        }
        rejection = next((message for reason, message in rejection_reasons.items() if reason in issue), None)
        if rejection:
            row.update(title='上次纠错未采用', explanation=rejection,
                       decision='请将纠错意见限定在已列出的问题范围内，再提交纠错。')
            result.append(row)
            continue
        shared = next((design for design in draft.get('designs', [])
                       if f"设计 scene:design:{design['id']}，" in issue), None)
        if shared and '设计主体未参与其声明的镜头' in issue:
            match = re.search(r'，镜头 ([^；]+)；', issue)
            missing = [value.strip() for value in match[1].split(',')] if match else []
            targets = [(index, shot) for index, shot in enumerate(shots) if shot['id'] in missing]
            if targets and len(targets) == len(set(missing)):
                location = '、'.join(f'镜头 {index + 1:02d}' for index, _shot in targets)
                label = CARD_TITLES.get(shared.get('card_type'), '设计卡').removesuffix('卡')
                name = names.get(shared.get('object_id'))
                row.update(title=f'{location} · 共享{label}',
                    explanation=f'“{name}”的共享{label}适用于{location}，但这些镜头未将该对象列为参与对象。' if name else f'共享{label}涉及的对象未被列入{location}的参与对象，相关对象无法识别。',
                    decision='请确认对象是否参与这些镜头；若不参与，请限定共享设计的适用范围。',
                    context='\n'.join(f"镜头 {index + 1:02d}：{shot.get('excerpt', '')}" for index, shot in targets))
                result.append(row)
                continue
        for index, shot in enumerate(shots):
            if not re.search(r'设计 shot:' + re.escape(shot['id']) + r':', issue):
                continue
            row['title'] = f'镜头 {index + 1:02d} · 关联问题'
            row['context'] = shot.get('excerpt', '')
            if '设计主体未参与其声明的镜头' in issue:
                match = re.search(r'，对象 ([^，]+)，', issue)
                name = names.get(match[1]) if match else None
                row.update(title=f'镜头 {index + 1:02d} · 对象关联',
                    explanation=f'设计涉及“{name}”，但其适用镜头未将该对象列为参与对象。' if name else '设计涉及的对象未被列入其适用镜头的参与对象，相关对象无法识别。',
                    decision='请确认对象是否参与这些镜头，或调整设计的适用范围。')
            elif '引用' in issue or '依赖' in issue:
                row.update(explanation='设计引用的内容不存在，或超出当前镜头的适用范围。',
                    decision='请核对设计应引用的内容及其适用范围。')
            break
        result.append(row)
    if saved.get('decision_reason'):
        result.append({'title': '需要调整处理方式', 'explanation': saved['decision_reason'],
                       'decision': '请重新选择方案或修改纠错意见，依据不足时保留问题。', 'context': ''})
    return result


def readable_structure_options(saved: dict, objects: list[dict]) -> list[dict]:
    """Keep executable choices intact while resolving their display labels from frozen evidence."""
    draft = saved.get('draft') or {}
    labels = {shot['id']: f'镜头 {index + 1:02d}' for index, shot in enumerate(draft.get('shots', []))}
    labels.update({item['id']: item['name'] for item in objects + draft.get('missed_objects', [])})
    def readable(text):
        for identity, label in sorted(labels.items(), key=lambda pair: len(pair[0]), reverse=True):
            text = text.replace('镜头 ' + identity, label)
            text = re.sub(r'(?<![\w])' + re.escape(identity) + r'(?![\w])', lambda _match, value=label: value, text)
        return text
    return [{**option, 'title': readable(option['title']), 'impact': readable(option['impact'])}
            for option in saved.get('options', [])]


def structure_attempt(task) -> dict:
    """Use only this task's diagnostics; infer legacy append records only from an exact prefix."""
    saved = (task.result or {}).get('storyboard_structure') or {}
    resume = task.input_snapshot.get('run_args', {}).get('structure_resume') or {}
    checkpoint_only = bool(resume) and saved.get('issues') == resume.get('issues') and saved.get('output') == resume.get('output')
    diagnostics = [] if checkpoint_only else saved.get('attempt_issues')
    if diagnostics is None:
        issues, previous = saved.get('issues', []), resume.get('issues', [])
        diagnostics = issues[len(previous):] if issues[:len(previous)] == previous else []
    title = '本轮执行未完成' if task.status != 'cancelled' else '本轮已取消'
    reason = '该轮未记录独立原因，请查看技术诊断。'
    if saved.get('decision_reason') and not checkpoint_only:
        title, reason = '需要调整处理方式', '模型认为：' + saved['decision_reason']
    else:
        converted = user_structure_issues({'issues': diagnostics}, [])
        rejected = next((issue for issue in converted if issue['title'] == '上次纠错未采用'), None)
        if rejected:
            title, reason = '本轮修改未采用', rejected['explanation']
        elif diagnostics:
            reason = '本轮输出未通过校验，未形成可采用结果。请查看技术诊断。'
        elif task.status == 'cancelled':
            reason = '本轮执行已取消。'
        elif (not saved or checkpoint_only) and task.error_message:
            reason = '本轮调用或执行未完成，请查看技术诊断。'
    if task.status == 'succeeded':
        title, reason = '本轮执行已完成', '该轮任务已完成；结果是否应用以画布记录为准。'
    elif task.status == 'cancelled':
        title, reason = '本轮已取消', '本轮执行已取消。'
    result = task.result or {}
    if task.status in ('failed', 'cancelled') and (
            result.get('review_state') == 'pending' or task.input_snapshot.get('review_retry_from')):
        corrected = bool(task.input_snapshot.get('run_args', {}).get('structure_resume') or result.get('structure_history'))
        title = '纠错完成，审查未完成' if corrected else '候选已保留，审查未完成'
        reason = '已保留候选。' + (task.error_message or '本轮审查未完成。') + ' 可仅重试审查。'
        detail = result.get('design_diagnostics') or {}
        diagnostics = detail.get('issues', [])
        if detail.get('output'):
            diagnostics = [*diagnostics, '模型响应：' + detail['output']]
        elif not diagnostics:
            diagnostics = [task.error_message or '审查未完成', '该轮未记录模型原始响应。']
    if result.get('prompt_state') == 'pending' and task.status in ('failed', 'cancelled'):
        title = '设计已完成，提示词生成未完成'
        reason = '已保留设计与已完成单元，可仅重试未完成的提示词。'
        detail = result.get('design_diagnostics') or {}
        diagnostics = [task.error_message or '提示词生成未完成', *detail.get('issues', [])]
        if detail.get('output'):
            diagnostics.append('提示词响应：' + detail['output'])
    return {'task_id': task.id, 'created_at': task.created_at.isoformat() + 'Z', 'status': task.status,
            'title': title, 'reason': reason,
            'correction_notes': task.input_snapshot.get('storyboard_request', {}).get('correction_notes', ''),
            'diagnostics': diagnostics or ([task.error_message] if task.error_message else [])}
