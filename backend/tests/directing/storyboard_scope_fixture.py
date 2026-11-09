"""全新合成分镜，不包含存量用户文本。"""

FRONT = '林舟在码头打开铜匣。'
START = '林舟向匣内伸手。'
END = '巡灯照亮纸面，林舟举起海图。'
SCRIPT = FRONT + START + END


def scope(*shots, phase='all', condition_id=None, occurrence_ids=()):
    return {'shot_ids': list(shots), 'phase': phase, 'condition_id': condition_id,
            'occurrence_ids': list(occurrence_ids)}


def note(text, excerpt, applies=None, *, state='proposal', purpose='design', reason='明确工作单依据'):
    value = {'text': text, 'excerpt': excerpt, 'state': state, 'purpose': purpose, 'reason': reason}
    if applies is not None:
        value['scope'] = applies
    return value


def complex_design(person):
    """独立合成工作单，保留两镜、129 个字段、122 个显式适用声明。"""
    front, rear = scope('front'), scope('rear')
    video_a = scope('rear', phase='video', occurrence_ids=('take-out',))
    video_b = scope('rear', phase='video', condition_id='light-on', occurrence_ids=('lift',))
    photo = scope('front', phase='image')
    designs = [
        {'id': 'anchor', 'card_type': 'direction.anchor', 'adoption': 'dependency', 'fields': {
            'position': note('合用前段锚点', FRONT, front),
            'orientation': note('排除后镜锚点', END, rear),
            'scale': note('排除候选锚点', FRONT, scope('front', condition_id='extra'))}},
        {'id': 'blocking', 'card_type': 'direction.blocking', 'object_id': person, 'fields': {
            'position': {**note('前镜调度选择', FRONT, front), 'dependencies': [
                {'design_id': 'anchor', 'field_id': 'position', 'relation': 'position'},
                {'design_id': 'anchor', 'field_id': 'scale', 'relation': 'anchor', 'candidate': True},
                {'design_id': 'continuity', 'field_id': 'before', 'relation': 'context'}]}}},
        {'id': 'guidance', 'card_type': 'direction.guidance', 'fields': {
            'priority': note('全场仅作解释', FRONT, scope(), purpose='background'),
            'prohibitions': note('视频不移轴', FRONT, scope(phase='video'), purpose='constraint'),
            'sound_strategy': note('仅声音阶段风声', END, scope(phase='sound'), purpose='constraint')}},
        {'id': 'continuity', 'card_type': 'direction.continuity', 'object_id': person, 'fields': {
            'before': note('移交前匣盖敞开', FRONT, front),
            'change': note('分段动作取出', START, video_a),
            'after': note('分段动作举高', END, video_b),
            'following_constraints': note('未满足条件不降灯', END, scope('rear', phase='video', condition_id='extra'))}},
        {'id': 'movement', 'card_type': 'direction.movement', 'fields': {
            'movement_speed': note('第二镜慢移', END, scope('rear', phase='image'))},
         'phases': [
            {'id': 'opening', 'name': '开启画面', 'frame': note('开启画面定位', FRONT, photo)},
            {'id': 'lifted', 'name': '举图画面', 'frame': note('排除另一镜头画面', END, scope('rear', phase='image'))}]},
        {'id': 'composition', 'card_type': 'direction.composition',
         'frame_target': {'design_id': 'movement', 'phase_id': 'opening'},
         'fields': {'composition': note('铜匣位于中央', FRONT, photo)}},
    ]
    families = [
        ('direction.camera', ('viewpoint', 'position', 'height_angle'), ('视线方向', '机位', '相机高度')),
        ('direction.lighting', ('light_direction', 'exposure_color', 'color_relationship'), ('光源方位', '曝光', '色温')),
        ('direction.performance', ('physical_action', 'gaze', 'breath'), ('身体动作', '视线', '呼吸')),
        ('direction.environment', ('activity', 'empty_space', 'reason'), ('环境动势', '天气', '背景人物')),
        ('direction.narrative', ('viewpoint', 'information_change', 'relationship_change'), ('叙事视点', '信息变化', '关系变化')),
        ('direction.style', ('visual_features', 'materials', 'colors'), ('视觉特征', '材料', '色彩')),
        ('direction.creative_control', ('freedom', 'allowed_range', 'keep'), ('允许发挥', '适用范围', '保留要求')),
    ]
    contexts = [('码头木桩', FRONT, front), ('匣盖铜铰', FRONT, scope('front', phase='video')),
                ('潮汐水线', FRONT, scope()), ('海图折角', START, video_a),
                ('远处栈桥', END, rear), ('巡灯玻璃', END, video_b)]
    count = sum(len(item['fields']) + len(item.get('phases', [])) for item in designs)
    for index in range(129 - count):
        family_index, field_index = divmod(index % 21, 3)
        kind, fields, labels = families[family_index]
        subject, excerpt, applies = contexts[index // 21]
        state = ('fact', 'proposal', 'undecided', 'absent', 'not_applicable')[index % 5]
        text = excerpt if state == 'fact' else f'{subject}的{labels[field_index]}保持可辨' if state == 'proposal' else ''
        state_note = note(text, excerpt, applies if index >= 7 else None, state=state,
                          purpose=('background', 'design', 'constraint')[index % 3], reason=f'核对{subject}的{labels[field_index]}')
        item = {'id': f'detail-{index}', 'card_type': kind, 'fields': {fields[field_index]: state_note}}
        if kind == 'direction.performance':
            item['object_id'] = person
        designs.append(item)
    return {
        'conditions': {'light-on': '巡灯照亮纸面', 'extra': '若改用补拍机位'},
        'missed_objects': [{'id': 'map', 'kind': 'prop', 'name': '海图', 'excerpt': END}],
        'shots': [
            {'id': 'front', 'excerpt': FRONT, 'object_ids': [person], 'estimated_seconds': 5,
             'beat': note('打开铜匣', FRONT, state='fact'),
             'frame_targets': [{'design_id': 'movement', 'phase_id': 'opening'}]},
            {'id': 'rear', 'excerpt': START + END, 'object_ids': [person, 'map'], 'estimated_seconds': 18,
             'beat': note('举起海图', END, state='fact'), 'occurrences': [
                 {'id': 'take-out', 'excerpt': START, 'object_ids': [person]},
                 {'id': 'lift', 'excerpt': END, 'object_ids': [person, 'map'], 'condition_ids': ['light-on']}]},
        ],
        'designs': designs,
    }
