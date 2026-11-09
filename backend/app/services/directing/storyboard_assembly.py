"""核对分镜语义并组装共同画布；不分配运行或写文档。"""

from functools import lru_cache
from uuid import NAMESPACE_URL, uuid5

from app.core.contracts.directing.scene_storyboard import SceneStoryboard, StoryboardField
from app.schemas.generation_canvas import CanvasDocument
from app.services.generation_canvas.catalog import canvas_catalog

STORYBOARD_KIND = 'directing_storyboard'
# This path handles whole fields and direct-shot scope. Structured phases are a separate organizer.
NESTED_FIELDS = frozenset(('direction.style', 'direction.camera', 'direction.lighting',
                           'direction.focus', 'direction.composition', 'direction.movement'))
SUBJECT_PORTS = {'direction.performance': 'participant', 'direction.situation': 'participant',
                 'direction.activity': 'participant', 'direction.blocking': 'participant',
                 'direction.dialogue': 'speaker'}
IDENTITY_FIELDS = {'direction.anchor': 'anchor_id', 'direction.blocking': 'blocking_id',
                   'direction.dialogue': 'dialogue_id', 'direction.continuity': 'continuity_id',
                   'direction.criterion': 'criterion_id', 'direction.event': 'event_id',
                   'direction.beat': 'beat_id'}


def _range(text: str, excerpt: str) -> tuple[int, int]:
    """返回唯一、连续且逐字相符的证据范围。"""
    start = text.find(excerpt)
    if not excerpt or start < 0 or text.find(excerpt, start + 1) >= 0:
        raise ValueError('分镜出处必须是在本场原文可唯一定位的完整摘录')
    return start, start + len(excerpt)


def _validate_field(note: StoryboardField, text: str, shot_span: tuple[int, int], *, complete: bool) -> None:
    """两模式均要求原文事实可核实，只有完整模式允许标记创作提议。"""
    if note.excerpt:
        start, end = _range(text, note.excerpt)
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
    """与当前真实卡片目录对齐，不接受临时字段或复杂分段。"""
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
        _range(source, item.excerpt)
        objects[item.id] = item.kind
        object_sources.add(source_key)
    catalog = storyboard_design_fields()
    shot_ids, last = set(), 0
    for shot in result.shots:
        span = _range(source, shot.excerpt)
        if shot.id in shot_ids or span[0] < last:
            raise ValueError('镜头身份必须唯一并按原文顺序排列，范围不得重叠')
        shot_ids.add(shot.id)
        last = span[1]
        if len(shot.object_ids) != len(set(shot.object_ids)) or any(item not in objects for item in shot.object_ids):
            raise ValueError('镜头参与对象必须明确存在且不可重复')
        for field in (shot.narrative_role, shot.visible_result, shot.estimated_duration, shot.beat):
            if field:
                _validate_field(field, source, span, complete=complete)
        design_ids = set()
        for design in shot.designs:
            fields = set(catalog.get(design.card_type, ()))
            if (design.id in design_ids or not design.card_type.startswith('direction.') or
                    not set(design.fields) <= fields or design.card_type == 'direction.shot'):
                raise ValueError('镜头设计身份重复或字段不属于实际设计卡')
            design_ids.add(design.id)
            if design.object_id and (design.object_id not in shot.object_ids or design.card_type not in SUBJECT_PORTS or
                    objects[design.object_id] == 'scene'):
                raise ValueError('设计对象与本镜头的实际关系不符')
            if design.card_type in SUBJECT_PORTS and not design.object_id and any(
                    note.state in ('fact', 'proposal') for note in design.fields.values()):
                raise ValueError('本设计需明确适用的参与对象')
            for field in design.fields.values():
                _validate_field(field, source, span, complete=complete)


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

    def _source(self, excerpt: str, field_id: str | None = None) -> dict:
        start, end = _range(self.args['script_text'], excerpt)
        return {'card_id': self.baseline.fixed_source.card_id, 'field_id': field_id,
                'start': start, 'end': end, 'excerpt': excerpt, 'source_version': self.args['source_version']}

    def _card(self, key: str, card_type: str, *, sources: list[dict] | None = None, **fields) -> dict:
        card = {'id': self._id(key), 'type': card_type, **fields}
        self.document['cards'].append(card)
        self.index['origins'][card['id']] = {'semantic_key': key, 'sources': sources or []}
        return card

    def _edge(self, source: dict, port: str, target: dict, target_port: str) -> str:
        key = self._id(f"edge:{source['id']}:{port}:{target['id']}:{target_port}")
        self.document['edges'].append({'id': key, 'source_card': source['id'], 'source_port': port,
                                       'target_card': target['id'], 'target_port': target_port})
        self.document['input_order'].setdefault(target['id'], {}).setdefault(target_port, []).append(key)
        return key

    def _output(self, card: dict, port: str, object_id: str | None = None) -> dict:
        result = {'canvas_id': self.baseline.id, 'card_id': card['id'], 'port_id': port, 'position': 0}
        if object_id:
            result['object_id'] = object_id
        return result

    def _adopt(self, source: dict, port: str, target: dict, target_port: str, *,
               object_id: str | None = None, subject_name: str | None = None) -> None:
        edge_id = self._edge(source, port, target, target_port)
        binding = {'id': edge_id, 'source': self._output(source, port, object_id),
                   'input_port': target_port, 'prompt_owned': False}
        if subject_name:
            binding['subject_name'] = subject_name
        target.setdefault('input_bindings', []).append(binding)

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

    def _design(self, key: str, item) -> dict:
        fields = {field: self._field(note) for field, note in item.fields.items()}
        sources = [self._source(note.excerpt, field) for field, note in item.fields.items() if note.excerpt]
        data = {'fields': fields} if item.card_type in NESTED_FIELDS else fields
        if identity := IDENTITY_FIELDS.get(item.card_type):
            data[identity] = self._id(key + ':identity')
        card = self._card(key, item.card_type, sources=sources, **data)
        if item.object_id:
            subject = self.objects[item.object_id][0]
            self._adopt(subject, 'object', card, SUBJECT_PORTS[item.card_type], object_id=subject['object_id'])
        return card

    def _production(self, key: str, sources: list[dict], shot) -> dict:
        capability = self.args.get('production_capability')
        modality = capability['modality'] if capability else 'image'
        config = {}
        if capability and modality == 'image':
            config['count'] = capability['min_count']
        if capability and modality == 'video':
            ratios = capability['ratios']
            config['ratio'] = '16:9' if '16:9' in ratios else next(iter(ratios), None)
        model = self._card(key, f'model.{modality}', sources=[self._source(shot.excerpt)],
                           model_id=self.args.get('production_model_id'), config=config)
        for source in sources:
            self._adopt(source, 'text', model, 'text')
        if capability:
            port = 'image' if modality == 'image' else 'subject_image'
            for object_key in shot.object_ids:
                _, reference = self.objects[object_key]
                if reference.get('image_binding') and port in capability['input_ports']:
                    self._adopt(reference, 'image', model, port,
                                subject_name=reference['name'] if modality == 'video' else None)
        return model

    def build(self, result: SceneStoryboard) -> CanvasDocument:
        """先共享对象再顺序建镜，媒体只按真实能力和已有选择采用。"""
        self._prepare_objects(result.missed_objects)
        for ordinal, shot in enumerate(result.shots, 1):
            key = f'shot:{shot.id}'
            shot_id = self._id(key + ':identity')
            visible = shot.visible_result or StoryboardField(state='fact', text=shot.excerpt, excerpt=shot.excerpt)
            source = self._source(visible.excerpt, 'visible_result') if visible.excerpt else self._source(shot.excerpt)
            card = self._card(key, 'direction.shot', sources=[source], shot_id=shot_id, name=f'镜头 {ordinal:02d}',
                              visible_result=self._field(visible))
            for field in ('narrative_role', 'estimated_duration'):
                note = getattr(shot, field) or StoryboardField(state='undecided')
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
            cards.extend(self._design(f'{key}:design:{item.id}', item) for item in shot.designs)
            model = self._production(key + ':model', cards, shot)
            group_id = self._group(key + ':group', card['name'], [item['id'] for item in [*cards, model]])
            self.index['shots'].append({'shot_id': shot_id, 'card_id': card['id'], 'group_id': group_id,
                                        'object_ids': [self.objects[item][0]['object_id'] for item in shot.object_ids],
                                        'model_card_ids': [model['id']]})
        return CanvasDocument.model_validate(self.document)
