"""Compile grounded prose only after the final production units have been assembled."""
import hashlib
import json
import re
from uuid import uuid4

from app.core.contracts.directing.storyboard_prompt import GeneratedVideoPrompt, StoryboardPromptOutput
from app.schemas.generation_canvas import CanvasDocument, PromptDocument, VideoModelCard
from app.services.directing.ai import DirectingOutputError
from app.services.directing.storyboard_review import invoke_storyboard_json


def prompt_units(checkpoint):
    """Public review evidence includes the exact editable text and attachment plan."""
    document = CanvasDocument.model_validate(checkpoint['document'])
    return [{'card_id': card.id, 'prompt': card.prompt.model_dump(mode='json'),
             'generated_prompt': card.generated_prompt.model_dump(mode='json'),
             'inputs': writing_inputs(document, card, {'script_text': '', 'mode': document.storyboard.mode if document.storyboard else 'complete'})}
            for card in document.cards if isinstance(card, VideoModelCard) and card.generated_prompt]



def writing_inputs(document, card, args):
    """Offer actual adopted identities, including references awaiting their media output."""
    cards = {row.id: row for row in document.cards}
    designs, references = [], []
    for binding in card.input_bindings:
        source = cards.get(binding.source.card_id)
        if source is None:
            continue
        row = {'binding_id': binding.id, 'card': source.model_dump(mode='json'),
               'input_port': binding.input_port, 'subject_name': binding.subject_name}
        (designs if source.type.startswith('direction.') else references).append(row)
    unit = next((shot.model_dump(mode='json') for shot in document.storyboard.shots if card.id in shot.model_card_ids), None) if document.storyboard else None
    segment = next((item for item in (unit or {}).get('segments', []) if item['model_card_id'] == card.id), None)
    if segment and unit:
        unit['segments'] = [segment]
        unit['model_card_ids'] = [card.id]
    return {'prompt_unit': {'card_id': card.id, 'shot': unit, 'segment': segment}, 'script_text': args['script_text'],
            'designs': designs, 'references': references, 'config': card.config.model_dump(mode='json'), 'mode': args['mode'],
            'correction_notes': args.get('structure_resume', {}).get('correction_notes', args.get('correction_notes', ''))}


def input_identity(inputs, generated=None):
    """Only changes to incorporated content invalidate fixed prose, not attachment edits."""
    inputs = json.loads(json.dumps(inputs))
    attached = {row['card_id'] for row in (generated or {}).get('designs', []) if row['placement'] in ('before', 'after')}
    for row in [*inputs['designs'], *inputs['references']]:
        row['card'].pop('sources', None)
        if row['card']['id'] in attached:
            row['card'] = {'id': row['card']['id'], 'type': row['card']['type']}
    return hashlib.sha256(json.dumps(inputs, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def write_video_prompt(llm, inputs):
    """One attempt per unit; the task owns persistence and phase-specific recovery."""
    result = invoke_storyboard_json(llm, inputs, StoryboardPromptOutput,
        '编写此视频单元的设计性提示词，原文仅为事实依据，结合设计编写可执行的动作、表演、对白与镜头描述，不能照抄原文或仅排列引用。'
        'mode 为 faithful 时不新增原文之外的事实或动作，只组织已提供设计。仅编写 prompt_unit 所属单元，不将其他镜头动作带入。只使用提供的 binding_id；人物素材引用以 reference 片段插入句中，不自行编造素材或名称映射。'
        'designs 必须逐一列出输入 designs 的 card.id，不重不漏。body 表示已融合到文字，不再追加；reference 表示正文引用整卡且不重复转述；before/after 表示独立附加。'
        '动作、节拍、事件、表演、站位、活动、对白、运镜默认融入正文；整体风格、摄影机、灯光、情境、锚点、叙事、环境默认前置；规则、事实、创作控制、指导、验收默认后置。'
        '具体阶段、动作、目标画面优先于类型，焦点、构图、连续性、声音按实际作用判断；制作片段指导融入正文。保留未定和适用范围。'
        '只返回 JSON。', '视频提示词生成结果无效，请重试提示词生成', response_label='提示词响应')
    if any(part.kind == 'text' and re.search(r'(?<!\\)@', part.text) for part in result.segments):
        raise DirectingOutputError('提示词中的 @ 引用尚未绑定，请重试提示词生成')
    bindings = {row['binding_id']: row for row in [*inputs['designs'], *inputs['references']]}
    expected = {row['card']['id'] for row in inputs['designs']}
    placements = {row.card_id: row.placement for row in result.designs}
    references = {part.binding_id for part in result.segments if part.kind == 'reference'}
    if (set(placements) != expected or len(placements) != len(result.designs)
            or not references <= bindings.keys()
            or not any(part.kind == 'text' and part.text.strip() for part in result.segments)):
        raise DirectingOutputError('视频提示词包含缺失设计、无效引用或空正文，请重试提示词生成')
    for binding_id in references:
        source_id = bindings[binding_id]['card']['id']
        if source_id in placements and placements[source_id] != 'reference':
            raise DirectingOutputError('正文设计引用与附加方式冲突，请重试提示词生成')
    for source_id, placement in placements.items():
        if placement == 'reference' and not any(bindings[key]['card']['id'] == source_id for key in references):
            raise DirectingOutputError('设计声明正文引用但没有引用片段，请重试提示词生成')
    return result


def apply_video_prompt(card, result):
    """Persist real binding references; display names never become identity keys."""
    card.prompt = PromptDocument.model_validate({'segments': [
        {'id': uuid4().hex, 'kind': part.kind, **({'text': part.text} if part.kind == 'text' else {'binding_id': part.binding_id})}
        for part in result.segments]})
    card.generated_prompt = GeneratedVideoPrompt(designs=result.designs)
