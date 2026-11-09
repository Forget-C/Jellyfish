"""核对分镜语义并组装共同画布；不分配运行或写文档。"""

from functools import lru_cache
from uuid import NAMESPACE_URL, uuid5

from app.core.contracts.directing.scene_storyboard import SceneStoryboard, StoryboardField
from app.schemas.generation_canvas import CanvasDocument
from app.services.directing.storyboard_scope import (
    RELATIONS, REQUIRED_SUBJECTS, SUBJECT_PORTS, StoryboardDesignPlan, source_span,
)
from app.services.generation_canvas.catalog import CARD_TITLES, canvas_catalog
from app.services.generation_canvas.output_resolution import CanvasOutputContext

STORYBOARD_KIND = 'directing_storyboard'
NESTED_FIELDS = frozenset(('direction.style', 'direction.camera', 'direction.lighting',
                           'direction.focus', 'direction.composition', 'direction.movement'))
IDENTITY_FIELDS = {'direction.anchor': 'anchor_id', 'direction.blocking': 'blocking_id',
                   'direction.dialogue': 'dialogue_id',
                   'direction.criterion': 'criterion_id', 'direction.event': 'event_id',
                   'direction.beat': 'beat_id'}


def _validate_field(note: StoryboardField, text: str, shot_span: tuple[int, int], *, complete: bool) -> None:
    """两模式均要求原文事实可核实，只有完整模式允许标记创作提议。"""
    if note.excerpt:
        start, end = source_span(text, note.excerpt)
        if not shot_span[0] <= start < end <= shot_span[1]:
            raise ValueError('设计字段出处不属于当前镜头')
    if note.state == 'proposal':
        if not complete or not note.text.strip():
            raise ValueError('创作提议必须包含内容，且只允许在完整分镜模式使用')
        return
    if note.state == 'fact' and (not note.excerpt or not note.text.strip() or note.text not in note.excerpt):
        raise ValueError('原文事实必须逐字来自已核对原文')
    if note.state != 'fact' and note.text:
        raise ValueError('待确定或不适用字段不得带推断内容')
    if note.state in ('absent', 'not_applicable') and (not note.reason.strip() or not note.excerpt):
        raise ValueError('明确没有或不适用必须保留原文证据与理由')


@lru_cache(maxsize=1)
def storyboard_design_fields() -> dict[str, list[str]]:
    """与当前真实卡片目录对齐，不接受临时字段。"""
    return {card.type: [field.id for field in card.fields] for card in canvas_catalog().cards
            if card.type.startswith('direction.') and card.type != 'direction.shot'}


def validate_storyboard(result: SceneStoryboard, args: dict) -> None:
    """在模型纠错周期内拒绝无出处、非法身份与无法表达的字段。"""
    source = args['script_text']
    complete = args['mode'] == 'complete'
    objects = {item['id']: item['kind'] for item in args['objects']}
    object_sources = {(item['kind'], item['excerpt']) for item in args['objects']}
    for item in result.missed_objects:
        source_key = (item.kind, item.excerpt)
        if source_key in object_sources:
            raise ValueError('同类型对象出处已存在，必须使用现有对象身份')
        if item.id in objects:
            raise ValueError('补漏对象身份不能重复或覆盖已准备对象')
        if item.name not in item.excerpt:
            raise ValueError('补漏对象名称必须来自原文')
        source_span(source, item.excerpt)
        objects[item.id] = item.kind
        object_sources.add(source_key)
    catalog = storyboard_design_fields()
    shot_ids, occurrence_ids, last = set(), set(), 0
    if not complete and any(value not in source for value in result.conditions.values()):
        raise ValueError('忠实提取的条件须逐字来自原文')
    for shot in result.shots:
        span = source_span(source, shot.excerpt)
        if shot.id in shot_ids or span[0] < last:
            raise ValueError('镜头身份必须唯一并按原文顺序排列，范围不得重叠')
        shot_ids.add(shot.id)
        last = span[1]
        if len(shot.object_ids) != len(set(shot.object_ids)) or any(item not in objects for item in shot.object_ids):
            raise ValueError('镜头参与对象必须明确存在且不可重复')
        for field in (shot.narrative_role, shot.visible_result, shot.estimated_duration, shot.beat):
            if field:
                if field.scope or field.dependencies:
                    raise ValueError('镜头与节拍基本字段须保留唯一故事身份，复杂设计另列')
                _validate_field(field, source, span, complete=complete)
        if shot.estimated_seconds is not None and not complete and (
                not shot.estimated_duration or shot.estimated_duration.state != 'fact'):
            raise ValueError('忠实提取的预计时长必须有原文明示证据')
        _validate_occurrences(shot, result.conditions, occurrence_ids)
    for owner, designs in [(None, result.designs)] + [(shot, shot.designs) for shot in result.shots]:
        span = source_span(source, owner.excerpt) if owner else (0, len(source))
        for design in designs:
            _validate_design(design, catalog, objects, source, span, complete=complete)
    StoryboardDesignPlan(result).validate_relations(result)


def _validate_occurrences(shot, conditions, occurrence_ids) -> None:
    if len(set(shot.condition_ids)) != len(shot.condition_ids) or not set(shot.condition_ids) <= conditions.keys():
        raise ValueError('镜头引用未声明或重复的条件')
    cursor = 0
    for occurrence in shot.occurrences:
        if occurrence.id in occurrence_ids:
            raise ValueError('镜头出现项身份必须唯一')
        occurrence_ids.add(occurrence.id)
        start = shot.excerpt.find(occurrence.excerpt, cursor)
        if start < 0 or shot.excerpt[cursor:start].strip():
            raise ValueError('镜头出现项必须按顺序连续覆盖原文')
        cursor = start + len(occurrence.excerpt)
        if not set(occurrence.condition_ids) <= conditions.keys() or len(set(occurrence.condition_ids)) != len(occurrence.condition_ids):
            raise ValueError('镜头出现项引用未声明或重复的条件')
        if occurrence.object_ids is not None and (not set(occurrence.object_ids) <= set(shot.object_ids)
                or len(set(occurrence.object_ids)) != len(occurrence.object_ids)):
            raise ValueError('镜头出现项只能采用该镜头的明确参与对象')
    if shot.occurrences and shot.excerpt[cursor:].strip():
        raise ValueError('镜头出现项遗漏原镜头范围')


def _validate_design(design, catalog, objects, source, span, *, complete) -> None:
    if (design.card_type not in catalog or not set(design.fields) <= set(catalog[design.card_type])
            or not (design.fields or design.phases)):
        raise ValueError('镜头设计字段不属于实际设计卡')
    phase_ids = {item.id for item in design.phases}
    if design.phases and (design.card_type != 'direction.movement' or len(phase_ids) != len(design.phases)):
        raise ValueError('运镜阶段必须具有唯一身份并属于运镜卡')
    if design.frame_target and design.card_type != 'direction.composition':
        raise ValueError('构图定位必须声明在实际构图卡')
    if design.object_id and (design.object_id not in objects or design.card_type not in SUBJECT_PORTS
            or objects[design.object_id] == 'scene'):
        raise ValueError('设计对象与本镜头的实际关系不符')
    if design.card_type in REQUIRED_SUBJECTS and not design.object_id and any(
            note.state in ('fact', 'proposal') for note in design.fields.values()):
        raise ValueError('本设计需明确适用的参与对象')
    for note in [*design.fields.values(), *(phase.frame for phase in design.phases)]:
        _validate_field(note, source, span, complete=complete)


def _identity(canvas_id: str, key: str) -> str:
    """同一画布同一结果重开时保留身份，不接受模型生成的卡片 ID。"""
    return uuid5(NAMESPACE_URL, f'scene-storyboard:{canvas_id}:{key}').hex


class StoryboardAssembly:
    """把明确范围转换为真实卡片、采用及独立来源索引。"""

    def __init__(self, args: dict, task_id: str, baseline: CanvasDocument):
        self.args, self.baseline = args, baseline
        self.document = baseline.model_dump()
        self.document['storyboard'] = self.index = {
            'task_id': task_id, 'mode': args['mode'], 'source_version': args['source_version'],
            'origins': {}, 'objects': [], 'shots': [],
        }
        self.objects = {}

    def _id(self, key: str) -> str:
        return _identity(self.baseline.id, key)

    def _source(self, excerpt: str, field_id: str | None = None, *, start: int | None = None) -> dict:
        start, end = source_span(self.args['script_text'], excerpt) if start is None else (start, start + len(excerpt))
        return {'card_id': self.baseline.fixed_source.card_id, 'field_id': field_id,
                'start': start, 'end': end, 'excerpt': excerpt, 'source_version': self.args['source_version']}

    def _card(self, key: str, card_type: str, *, sources: list[dict] | None = None, **fields) -> dict:
        card = {'id': self._id(key), 'type': card_type, **fields}
        self.document['cards'].append(card)
        self.index['origins'][card['id']] = {'semantic_key': key, 'sources': sources or []}
        return card

    def _edge(self, source: dict, port: str, target: dict, target_port: str) -> str:
        key = self._id(f"edge:{source['id']}:{port}:{target['id']}:{target_port}")
        order = self.document['input_order'].setdefault(target['id'], {}).setdefault(target_port, [])
        if key not in order:
            self.document['edges'].append({'id': key, 'source_card': source['id'], 'source_port': port,
                                           'target_card': target['id'], 'target_port': target_port})
            order.append(key)
        return key

    def _output(self, card: dict, port: str, object_id: str | None = None) -> dict:
        result = {'canvas_id': self.baseline.id, 'card_id': card['id'], 'port_id': port, 'position': 0}
        if object_id:
            result['object_id'] = object_id
        return result

    def _adopt(self, source: dict, port: str, target: dict, target_port: str, *,
               object_id: str | None = None, subject_name: str | None = None) -> str:
        edge_id = self._edge(source, port, target, target_port)
        binding = {'id': edge_id, 'source': self._output(source, port, object_id),
                   'input_port': target_port, 'prompt_owned': False}
        if subject_name:
            binding['subject_name'] = subject_name
        target.setdefault('input_bindings', []).append(binding)
        return edge_id

    def _group(self, key: str, name: str, cards: list[str]) -> str:
        group_id = self._id(key)
        self.document['groups'].append({'id': group_id, 'name': name, 'card_ids': cards})
        return group_id

    def _prepare_objects(self, missed_objects) -> None:
        rows = self.args['objects'] + [{
            **item.model_dump(), 'id': self._id(f'missed:{item.id}'), 'semantic_id': item.id,
        } for item in missed_objects]
        members = [self.baseline.fixed_source.card_id]
        names = set()
        for row in rows:
            object_id, name = row['id'], row['name'].strip()
            category = 'place' if row['kind'] == 'scene' else row['kind']
            distinct_name, number = name, 2
            while (category, distinct_name) in names:
                distinct_name = f'{name[:244]}（{number}）'
                number += 1
            names.add((category, distinct_name))
            source = self._source(row['excerpt'])
            key = f'object:{object_id}'
            description = self._card(key, f'content.{category}', sources=[source], name=distinct_name,
                                     object_id=object_id, text=row['excerpt'])
            reference = self._card(key + ':ref', f'reference.{category}', sources=[source], type_version=2,
                                   name=distinct_name, name_binding=self._output(description, 'object', object_id))
            self._edge(description, 'object', reference, 'name')
            members += [description['id'], reference['id']]
            if file_id := row.get('image_file_id'):
                image = self._card(key + ':image', 'content.image', file_id=file_id, sources=[source])
                self._edge(image, 'image', reference, 'image_source')
                reference['image_binding'] = {'file_id': file_id, 'source': self._output(image, 'image')}
                members.append(image['id'])
            self.index['objects'].append({'object_id': object_id, 'description_card_id': description['id'],
                                          'reference_card_id': reference['id'],
                                          'origin': 'missed' if 'semantic_id' in row else 'prepared'})
            self.objects[row.get('semantic_id', object_id)] = (description, reference)
        self._group('common', '原文与共享对象', members)

    @staticmethod
    def _field(note: StoryboardField) -> dict:
        """标记显式提取编辑策略；作者变化不覆盖状态、用途或证据。"""
        return {'text': note.text, 'state': note.state, 'purpose': note.purpose, 'authorship': 'model',
                'source_locator': note.excerpt, 'extraction_context': 'storyboard', 'extraction_reason': note.reason or None,
                'metadata_fields': ['state', 'purpose', 'source_locator']}

    def _design(self, piece, shot_ids, conditions) -> dict:
        fields, phases, sources, declared = {}, [], [], []
        design = piece.design
        for field, note in piece.notes.items():
            if field.startswith('phase:'):
                logical_id = field.removeprefix('phase:')
                phase = next(item for item in design.phases if item.id == logical_id)
                phase_id = self._id(f'{piece.key}:phase:{logical_id}')
                phases.append({'id': phase_id, 'name': phase.name, 'frame': self._field(note)})
                field = 'phase:' + phase_id
            else:
                fields[field] = self._field(note)
            if note.excerpt:
                sources.append(self._source(note.excerpt, field))
            if note.scope:
                declared.append(field)
        data = {'fields': fields} if design.card_type in NESTED_FIELDS else fields
        if phases:
            data['phases'] = phases
        if identity := IDENTITY_FIELDS.get(design.card_type):
            data[identity] = self._id(piece.key + ':identity')
            if design.card_type != 'direction.dialogue':
                data['name'] = f"{CARD_TITLES[design.card_type]} {self._id(piece.key)[:6]}"
        scope = piece.scope
        if declared:
            labels = [f'镜头 {ordinal:02d}' for ordinal, key in enumerate(shot_ids, 1) if key in scope.shots]
            description = '全场' if not piece.owner and not scope.declared_shots and not scope.occurrences else '、'.join(labels)
            data['scope'] = {'description': description, 'phase': scope.phase if scope.phase != 'all' else None,
                             'condition': conditions.get(scope.condition, '')}
        card = self._card(piece.key, design.card_type, sources=sources, **data)
        if declared:
            self.index['origins'][card['id']]['applicability'] = {
                'fields': declared, 'shot_ids': [shot_ids[key] for key in scope.declared_shots],
                'phase': scope.phase, 'condition_id': scope.condition, 'occurrence_ids': list(scope.occurrences),
            }
        if design.object_id:
            subject = self.objects[design.object_id][0]
            self._adopt(subject, 'object', card, SUBJECT_PORTS[design.card_type], object_id=subject['object_id'])
        return card

    def _frame_target(self, piece, phase_id, cards) -> dict:
        return {'card_id': cards[piece.key]['id'], 'state_id': 'phase:' + self._id(f'{piece.key}:phase:{phase_id}')}

    def _connect_designs(self, plan, cards) -> None:
        for piece in plan.pieces:
            card = cards[piece.key]
            for field, source_piece, relation in plan.relations(piece):
                source = cards[source_piece.key]
                output, port = RELATIONS[relation.relation]
                if relation.candidate or relation.relation in ('context', 'anchor'):
                    edge = self._edge(source, output, card, port)
                    if not relation.candidate:
                        self._field_dependency(piece, field, card, source, output, edge)
                else:
                    self._adopt(source, output, card, port, object_id=source.get(output + '_id'))
            if target := piece.design.frame_target:
                movement = plan.frame(piece.owner, target)
                card['frame_target'] = self._frame_target(movement, target.phase_id, cards)
                self._edge(cards[movement.key], 'text', card, 'text')

    def _field_dependency(self, piece, field, card, source, port, edge):
        if field.startswith('phase:'):
            phase = self._id(f'{piece.key}:phase:{field.removeprefix("phase:")}')
            value = next(item['frame'] for item in card['phases'] if item['id'] == phase)
        else:
            value = card.get('fields', card)[field]
        segments = value.setdefault('document', {'segments': [
            {'id': self._id(f'{piece.key}:{field}:text'), 'kind': 'text', 'text': value['text'], 'literal': True},
        ]})['segments']
        segments.append({'id': self._id(f'{edge}:{field}'), 'kind': 'reference',
                         'source': self._output(source, port, source.get(port + '_id'))})

    def _reference_uses(self, model: dict, object_keys: list[str]) -> list[dict]:
        """即使缺图，也登记可由用户明确补齐的当前镜头参考。"""
        port = 'image' if model['type'] == 'model.image' else 'subject_image'
        active_ids = {item['id'] for item in model.get('input_bindings', [])}
        uses = []
        for object_key in object_keys:
            description, reference = self.objects[object_key]
            binding_id = self._id(f"edge:{reference['id']}:image:{model['id']}:{port}")
            uses.append({'object_id': description['object_id'], 'model_card_id': model['id'],
                         'binding_id': binding_id, 'active': binding_id in active_ids})
        return uses

    def _production(self, key, sources, evidence, object_keys, *, segment=None, seconds=None, targets=()) -> dict:
        capability = self.args.get('production_capability')
        modality = capability['modality'] if capability else 'image'
        config = {}
        if capability and modality == 'image':
            config['count'] = capability['min_count']
        if modality == 'video':
            ratios = capability['ratios']
            config['ratio'] = segment.ratio if segment else '16:9' if '16:9' in ratios else next(iter(ratios), None)
            minimum, maximum = capability['min_seconds'], capability['max_seconds']
            if segment:
                config['seconds'] = segment.seconds
            elif seconds is not None and maximum is not None and (minimum or 0) <= seconds <= maximum:
                config['seconds'] = seconds
        model = self._card(key, f'model.{modality}', sources=[evidence],
                           model_id=self.args.get('production_model_id'), config=config)
        image_targets = {target['card_id']: target['state_id'] for target in targets}
        for source in sources:
            binding_id = self._adopt(source, 'text', model, 'text')
            if modality == 'image' and source['id'] in image_targets:
                model.setdefault('frame_targets', []).append({'binding_id': binding_id, 'state_id': image_targets[source['id']]})
        if capability:
            port = 'image' if modality == 'image' else 'subject_image'
            for object_key in object_keys:
                _, reference = self.objects[object_key]
                if reference.get('image_binding') and port in capability['input_ports']:
                    self._adopt(reference, 'image', model, port,
                                subject_name=reference['name'] if modality == 'video' else None)
        return model

    def _story_cards(self, key, shot, shot_id, ordinal):
        visible = shot.visible_result or StoryboardField(state='fact', text=shot.excerpt, excerpt=shot.excerpt)
        source = self._source(visible.excerpt, 'visible_result') if visible.excerpt else self._source(shot.excerpt)
        card = self._card(key, 'direction.shot', sources=[source], shot_id=shot_id, name=f'镜头 {ordinal:02d}',
                          visible_result=self._field(visible))
        for field in ('narrative_role', 'estimated_duration'):
            note = getattr(shot, field)
            if note is None and field == 'estimated_duration' and shot.estimated_seconds is not None:
                note = StoryboardField(state='proposal', text=f'{shot.estimated_seconds} 秒')
            note = note or StoryboardField(state='undecided')
            card[field] = self._field(note)
            if note.excerpt:
                self.index['origins'][card['id']]['sources'].append(self._source(note.excerpt, field))
        cards = [card]
        if shot.beat:
            beat = self._card(key + ':beat', 'direction.beat', beat_id=self._id(key + ':beat:identity'),
                              name=f'节拍 {ordinal:02d}', audience_must_see=self._field(shot.beat),
                              sources=[self._source(shot.beat.excerpt, 'audience_must_see')] if shot.beat.excerpt else [])
            self._adopt(beat, 'beat', card, 'covered_beat', object_id=beat['beat_id'])
            cards.append(beat)
        for object_key in shot.object_ids:
            description = self.objects[object_key][0]
            if description['type'] != 'content.place':
                self._adopt(description, 'object', card, 'participant', object_id=description['object_id'])
        return cards

    def _shot_production(self, key, result, shot, story, plan, designs, executable):
        capability = self.args.get('production_capability')
        phase = capability['modality'] if capability else 'image'
        occurrences = {item.id: item for item in shot.occurrences}
        organized = result.production_segments(shot.id)
        cards, models, segments, uses = [], [], [], []
        cursor = source_span(self.args['script_text'], shot.excerpt)[0]
        for ordinal, segment in enumerate(organized or [None], 1):
            occurrence = occurrences.get(segment.id) if segment else next(iter(occurrences.values()), None) if len(occurrences) == 1 else None
            conditions = set(shot.condition_ids) | set(occurrence.condition_ids if occurrence else ())
            objects = occurrence.object_ids if occurrence and occurrence.object_ids is not None else shot.object_ids
            excerpt = segment.excerpt if segment else shot.excerpt
            start = self.args['script_text'].find(excerpt, cursor)
            cursor = start + len(excerpt)
            evidence = self._source(excerpt, start=start)
            model_key = key + ':model'
            if segment:
                segment_key = f'{key}:segment:{segment.id}'
                model_key = segment_key + ':model'
                note = StoryboardField(state='fact', text=excerpt, excerpt=excerpt)
                basis = self._card(segment_key + ':basis', 'direction.guidance', name=f'制作片段 {ordinal:02d}',
                                   priority=self._field(note), sources=[{**evidence, 'field_id': 'priority'}])
                cards.append(basis)
                sources = [basis]
            else:
                sources = list(story)
            targets = [self._frame_target(plan.frame(shot.id, target), target.phase_id, designs)
                       for target in shot.frame_targets] if phase == 'image' else []
            target_cards = {item['card_id'] for item in targets}
            sources += [designs[piece.key] for piece in plan.pieces
                        if piece.key in executable and (piece.design.adoption == 'model' or designs[piece.key]['id'] in target_cards)
                        and piece.scope.applies(shot.id, phase, conditions, occurrence.id if occurrence else None)
                        and (not piece.design.object_id or piece.design.object_id in objects)]
            model = self._production(model_key, sources, evidence, objects,
                                     segment=segment, seconds=shot.estimated_seconds, targets=targets)
            cards.append(model)
            models.append(model['id'])
            uses.extend(self._reference_uses(model, objects))
            if segment:
                segments.append({'id': self._id(segment_key), 'occurrence_id': segment.id,
                                 'model_card_id': model['id'], 'basis_card_id': basis['id'],
                                 'object_ids': [self.objects[item][0]['object_id'] for item in objects],
                                 'condition_ids': sorted(conditions)})
        return cards, models, segments, uses

    def build(self, result: SceneStoryboard) -> CanvasDocument:
        """共用卡一份，镜头及制作按顺序编组，实际采用在这里确定。"""
        self._prepare_objects(result.missed_objects)
        common = self.document['groups'][-1]['card_ids']
        plan = StoryboardDesignPlan(result)
        shot_ids = {shot.id: self._id(f'shot:{shot.id}:identity') for shot in result.shots}
        designs = {piece.key: self._design(piece, shot_ids, result.conditions) for piece in plan.pieces}
        self._connect_designs(plan, designs)
        context = CanvasOutputContext(CanvasDocument.model_validate(self.document))
        executable = {piece.key for piece in plan.pieces
                      if any(note.state in ('fact', 'proposal', 'absent') for note in piece.notes.values())
                      and any(output.source.port_id == 'text' and output.available for output in
                              context.published_outputs(designs[piece.key]['id'], model_outputs={}))}
        common.extend(designs[piece.key]['id'] for piece in plan.pieces if len(piece.scope.shots) > 1)
        for ordinal, shot in enumerate(result.shots, 1):
            key = f'shot:{shot.id}'
            story = self._story_cards(key, shot, shot_ids[shot.id], ordinal)
            cards = story + [designs[piece.key] for piece in plan.pieces if piece.scope.shots == (shot.id,)]
            production, models, segments, uses = self._shot_production(key, result, shot, story, plan, designs, executable)
            group_id = self._group(key + ':group', story[0]['name'], [item['id'] for item in cards + production])
            self.index['shots'].append({'shot_id': shot_ids[shot.id], 'card_id': story[0]['id'], 'group_id': group_id,
                                        'object_ids': [self.objects[item][0]['object_id'] for item in shot.object_ids],
                                        'model_card_ids': models, 'segments': segments, 'reference_uses': uses})
        return CanvasDocument.model_validate(self.document)
