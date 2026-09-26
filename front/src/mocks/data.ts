export type ProjectStyle = '现实主义' | '科幻' | '古风' | '都市喜剧'

export type ChapterStatus = 'draft' | 'shooting' | 'done'

export interface ProjectStats {
  chapters: number
  roles: number
  scenes: number
  props: number
}

export interface Project {
  id: string
  name: string
  description: string
  style: ProjectStyle
  seed: number
  unifyStyle: boolean
  progress: number
  stats: ProjectStats
  /** 真实创建时间（后端 created_at）。项目列表按它倒序排列，缺失时界面显示「—」。 */
  createdAt?: string
  /** 项目起点：script=从剧本开始；prompts=从视频提示词开始。 */
  startMode?: 'script' | 'prompts'
  updatedAt: string
}

export interface Chapter {
  id: string
  projectId: string
  index: number
  title: string
  summary: string
  storyboardCount: number
  status: ChapterStatus
  updatedAt: string
}

export type ShotStatus = 'pending' | 'ready'

export interface Shot {
  id: string
  chapterId: string
  index: number
  title: string
  duration: number
  thumbnail: string
  status: ShotStatus
  scriptExcerpt: string
}

export type CameraShotType = '远景' | '中景' | '近景' | '特写'
export type CameraAngle = '平视' | '俯视' | '仰视' | '侧面'
export type CameraMovement = '拉镜' | '推镜' | '跟镜' | '固定'

export interface ShotDetail {
  id: string
  cameraShot: CameraShotType
  angle: CameraAngle
  movement: CameraMovement
  sceneAssetId: string | null
  duration: number
  moodTags: string[]
  atmosphere: string
  followAtmosphere: boolean
  dialog: {
    role: string
    text: string
  }[]
  hasBgm: boolean
}

export type AssetType = 'actor' | 'scene' | 'prop' | 'costume'

export interface Asset {
  id: string
  type: AssetType
  name: string
  description: string
  thumbnail: string
  tags: string[]
  promptTemplateId?: string
}

export type PromptCategory =
  | 'frame_head'
  | 'frame_tail'
  | 'frame_key'
  | 'video'
  | 'storyboard'
  | 'bgm'
  | 'sfx'
  | 'role'
  | 'combined'

export interface PromptTemplate {
  id: string
  category: PromptCategory
  name: string
  preview: string
  content: string
  variables: string[]
}

export type FileType = 'image' | 'video'

export interface FileItem {
  id: string
  type: FileType
  name: string
  thumbnail: string
  tags: string[]
  createdAt: string
  projectId: string
  chapterId?: string
}

export interface TimelineClip {
  id: string
  type: 'video' | 'audio'
  sourceId: string
  label: string
  start: number
  end: number
  track: number
}

/** Agent 类型：剧情提取、角色提取、场景提取、道具提取、其他 */
export type AgentTypeKey = 'plot' | 'character' | 'scene' | 'prop' | 'other'

export interface Agent {
  id: string
  name: string
  type: AgentTypeKey
  description: string
  isDefault: boolean
  version: string
  updatedAt: string
  createdAt: string
  createdBy: string
  updatedBy: string
}

/** 供应商状态（与 /api/v1/llm 实际接口一致） */
export type ProviderStatus = 'active' | 'testing' | 'disabled'

/** 供应商（snake_case 与真实 API ProviderRead 对齐） */
export interface Provider {
  id: string
  name: string
  base_url: string
  api_key?: string
  api_secret?: string
  description?: string
  status?: ProviderStatus
  created_by?: string
}

/** 模型类别：文本 / 图片 / 视频 */
export type ModelCategoryKey = 'text' | 'image' | 'video'

/** 模型（snake_case 与真实 API ModelRead 对齐） */
export interface Model {
  id: string
  name: string
  category: ModelCategoryKey
  provider_id: string
  params?: Record<string, unknown>
  description?: string
  is_default?: boolean
  created_by?: string
}

/** 模型管理全局设置（snake_case 与真实 API ModelSettingsRead 对齐） */
export interface ModelSettings {
  default_text_model_id: string | null
  default_image_model_id: string | null
  default_video_model_id: string | null
  api_timeout: number
  log_level: 'debug' | 'info' | 'warn' | 'error'
}

export const projects: Project[] = [
  {
    id: 'p1',
    name: '现实都市爱情短剧',
    description: '围绕北漂情侣的现实主义都市爱情故事，强调写实与情绪细节。',
    style: '现实主义',
    seed: 12345,
    unifyStyle: true,
    progress: 46,
    stats: {
      chapters: 8,
      roles: 6,
      scenes: 12,
      props: 24,
    },
    updatedAt: '2026-03-01 14:32',
  },
  {
    id: 'p2',
    name: '赛博朋克追击',
    description: '霓虹雨夜中的赛博朋克警匪追击短剧，强调光影与城市纵深。',
    style: '科幻',
    seed: 9876,
    unifyStyle: true,
    progress: 72,
    stats: {
      chapters: 5,
      roles: 4,
      scenes: 9,
      props: 18,
    },
    updatedAt: '2026-02-27 09:18',
  },
  {
    id: 'p3',
    name: '古风权谋·长安夜',
    description: '架空古代长安，朝堂与江湖交织，权谋与情义并重。',
    style: '古风',
    seed: 45678,
    unifyStyle: true,
    progress: 28,
    stats: {
      chapters: 12,
      roles: 8,
      scenes: 20,
      props: 35,
    },
    updatedAt: '2026-03-02 09:00',
  },
  {
    id: 'p4',
    name: '都市喜剧·合租日记',
    description: '三个性格迥异的年轻人合租一室，笑料与温情并存的日常。',
    style: '都市喜剧',
    seed: 11111,
    unifyStyle: false,
    progress: 55,
    stats: {
      chapters: 6,
      roles: 5,
      scenes: 8,
      props: 15,
    },
    updatedAt: '2026-03-01 18:22',
  },
  {
    id: 'p5',
    name: '科幻·深空信标',
    description: '人类首艘深空科考船在未知星域发现神秘信标，悬疑与硬科幻结合。',
    style: '科幻',
    seed: 77777,
    unifyStyle: true,
    progress: 10,
    stats: {
      chapters: 3,
      roles: 4,
      scenes: 6,
      props: 12,
    },
    updatedAt: '2026-02-26 16:45',
  },
]

export const chapters: Chapter[] = [
  {
    id: 'c1',
    projectId: 'p1',
    index: 1,
    title: '第1集：出租屋里的争吵',
    summary: '凌晨的出租屋里，小雨和阿川因为房租和未来爆发激烈争吵。',
    storyboardCount: 12,
    status: 'shooting',
    updatedAt: '2026-03-01 12:20',
  },
  {
    id: 'c2',
    projectId: 'p1',
    index: 2,
    title: '第2集：面试前夜',
    summary: '暴雨夜里，小雨接到最后一次面试通知，却发现身份证丢了。',
    storyboardCount: 10,
    status: 'draft',
    updatedAt: '2026-02-28 20:05',
  },
  {
    id: 'c3',
    projectId: 'p2',
    index: 1,
    title: '第1集：霓虹街口的交易',
    summary: '改造人情报贩子在雨夜街口完成一笔危险交易。',
    storyboardCount: 15,
    status: 'done',
    updatedAt: '2026-02-27 10:30',
  },
  {
    id: 'c4',
    projectId: 'p2',
    index: 2,
    title: '第2集：追车与巷战',
    summary: '警方与改造人在高架与巷弄间展开追逐与交火。',
    storyboardCount: 18,
    status: 'draft',
    updatedAt: '2026-02-26 14:00',
  },
  {
    id: 'c5',
    projectId: 'p3',
    index: 1,
    title: '第1集：入京',
    summary: '少年剑客初入长安，在客栈中听闻朝堂风云。',
    storyboardCount: 14,
    status: 'shooting',
    updatedAt: '2026-03-02 08:30',
  },
  {
    id: 'c6',
    projectId: 'p4',
    index: 1,
    title: '第1集：搬进来的第一天',
    summary: '三人初次见面，因生活习惯冲突闹出不少笑话。',
    storyboardCount: 8,
    status: 'done',
    updatedAt: '2026-03-01 17:00',
  },
]

export const shots: Shot[] = [
  {
    id: 's1',
    chapterId: 'c1',
    index: 1,
    title: '远景：城郊老旧小区夜景',
    duration: 6,
    thumbnail: '/mock/thumbnails/p1-c1-s1.jpg',
    status: 'ready',
    scriptExcerpt: '夜色下的老旧小区，昏黄路灯下只有零星行人经过。',
  },
  {
    id: 's2',
    chapterId: 'c1',
    index: 2,
    title: '中景：出租屋内静止的风扇',
    duration: 5,
    thumbnail: '/mock/thumbnails/p1-c1-s2.jpg',
    status: 'pending',
    scriptExcerpt: '电风扇吱呀吱呀地转着，镜头慢慢推向桌上的欠条。',
  },
  {
    id: 's3',
    chapterId: 'c1',
    index: 3,
    title: '近景：两人对峙的沉默',
    duration: 8,
    thumbnail: '/mock/thumbnails/p1-c1-s3.jpg',
    status: 'pending',
    scriptExcerpt: '小雨和阿川面对面坐着，谁也不肯先开口。',
  },
  {
    id: 's7',
    chapterId: 'c1',
    index: 4,
    title: '特写：桌上的欠条',
    duration: 4,
    thumbnail: '/mock/thumbnails/p1-c1-s4.jpg',
    status: 'ready',
    scriptExcerpt: '镜头推至皱巴巴的欠条，字迹模糊。',
  },
  {
    id: 's8',
    chapterId: 'c1',
    index: 5,
    title: '中景：小雨起身',
    duration: 5,
    thumbnail: '/mock/thumbnails/p1-c1-s5.jpg',
    status: 'ready',
    scriptExcerpt: '小雨猛地站起，椅子发出刺耳声响。',
  },
  {
    id: 's9',
    chapterId: 'c1',
    index: 6,
    title: '近景：阿川抬头',
    duration: 3,
    thumbnail: '/mock/thumbnails/p1-c1-s6.jpg',
    status: 'pending',
    scriptExcerpt: '阿川抬头看她，欲言又止。',
  },
  {
    id: 's10',
    chapterId: 'c1',
    index: 7,
    title: '远景：窗外夜色',
    duration: 6,
    thumbnail: '/mock/thumbnails/p1-c1-s7.jpg',
    status: 'pending',
    scriptExcerpt: '透过窗户可见远处路灯与零星车灯。',
  },
  {
    id: 's11',
    chapterId: 'c1',
    index: 8,
    title: '中景：小雨背对镜头',
    duration: 5,
    thumbnail: '/mock/thumbnails/p1-c1-s8.jpg',
    status: 'pending',
    scriptExcerpt: '小雨背对镜头站在门口，肩膀微微颤抖。',
  },
  {
    id: 's12',
    chapterId: 'c1',
    index: 9,
    title: '特写：门把手',
    duration: 2,
    thumbnail: '/mock/thumbnails/p1-c1-s9.jpg',
    status: 'ready',
    scriptExcerpt: '手握住门把手，停顿片刻。',
  },
  {
    id: 's13',
    chapterId: 'c1',
    index: 10,
    title: '中景：门被推开',
    duration: 4,
    thumbnail: '/mock/thumbnails/p1-c1-s10.jpg',
    status: 'pending',
    scriptExcerpt: '门开，走廊灯光涌入。',
  },
  {
    id: 's14',
    chapterId: 'c1',
    index: 11,
    title: '近景：阿川独坐',
    duration: 7,
    thumbnail: '/mock/thumbnails/p1-c1-s11.jpg',
    status: 'ready',
    scriptExcerpt: '阿川仍坐在桌前，低头不语。',
  },
  {
    id: 's15',
    chapterId: 'c1',
    index: 12,
    title: '远景：出租屋全景收尾',
    duration: 6,
    thumbnail: '/mock/thumbnails/p1-c1-s12.jpg',
    status: 'pending',
    scriptExcerpt: '空荡的出租屋，风扇仍在转，门半掩。',
  },
  {
    id: 's4',
    chapterId: 'c2',
    index: 1,
    title: '雨夜街道',
    duration: 5,
    thumbnail: '/mock/thumbnails/p1-c2-s1.jpg',
    status: 'pending',
    scriptExcerpt: '暴雨倾盆，小雨撑着破伞在路边翻包。',
  },
  {
    id: 's5',
    chapterId: 'c3',
    index: 1,
    title: '霓虹街口全景',
    duration: 7,
    thumbnail: '/mock/thumbnails/p2-c3-s1.jpg',
    status: 'ready',
    scriptExcerpt: '雨夜街口，全息广告与霓虹灯交织。',
  },
  {
    id: 's6',
    chapterId: 'c5',
    index: 1,
    title: '长安城门外',
    duration: 6,
    thumbnail: '/mock/thumbnails/p3-c5-s1.jpg',
    status: 'pending',
    scriptExcerpt: '少年牵马入城，城门守卫盘查。',
  },
]

export const shotDetails: ShotDetail[] = [
  {
    id: 's1',
    cameraShot: '远景',
    angle: '平视',
    movement: '固定',
    sceneAssetId: 'scene1',
    duration: 6,
    moodTags: ['压抑', '城市夜景'],
    atmosphere: '阴天、轻微雾气，路灯偏暖色调，整体偏低饱和度。',
    followAtmosphere: true,
    dialog: [],
    hasBgm: true,
  },
  {
    id: 's2',
    cameraShot: '中景',
    angle: '俯视',
    movement: '推镜',
    sceneAssetId: 'scene2',
    duration: 5,
    moodTags: ['焦虑', '窒息感'],
    atmosphere: '狭窄出租屋，顶灯偏冷白光，阴影明显。',
    followAtmosphere: true,
    dialog: [
      {
        role: '小雨',
        text: '要不，我们还是回老家吧……',
      },
    ],
    hasBgm: true,
  },
  {
    id: 's3',
    cameraShot: '近景',
    angle: '侧面',
    movement: '跟镜',
    sceneAssetId: 'scene2',
    duration: 8,
    moodTags: ['对峙', '临界点'],
    atmosphere: '镜头贴近人物，背景虚化，只剩呼吸声和电风扇声。',
    followAtmosphere: false,
    dialog: [
      {
        role: '阿川',
        text: '你说的“我们”，到底还有没有我？',
      },
    ],
    hasBgm: false,
  },
  {
    id: 's4',
    cameraShot: '中景',
    angle: '平视',
    movement: '固定',
    sceneAssetId: null,
    duration: 5,
    moodTags: ['焦虑', '雨夜'],
    atmosphere: '雨夜街道，路灯昏黄，雨丝可见。',
    followAtmosphere: true,
    dialog: [],
    hasBgm: true,
  },
  {
    id: 's5',
    cameraShot: '远景',
    angle: '俯视',
    movement: '固定',
    sceneAssetId: null,
    duration: 7,
    moodTags: ['赛博朋克', '雨夜'],
    atmosphere: '霓虹与全息广告，雨滴反射光影。',
    followAtmosphere: true,
    dialog: [],
    hasBgm: true,
  },
  {
    id: 's6',
    cameraShot: '中景',
    angle: '平视',
    movement: '跟镜',
    sceneAssetId: null,
    duration: 6,
    moodTags: ['古风', '入城'],
    atmosphere: '城门洞内明暗对比，尘土在光中飞扬。',
    followAtmosphere: true,
    dialog: [],
    hasBgm: true,
  },
  {
    id: 's7',
    cameraShot: '特写',
    angle: '俯视',
    movement: '推镜',
    sceneAssetId: 'scene2',
    duration: 4,
    moodTags: ['压抑', '细节'],
    atmosphere: '顶光，欠条褶皱与阴影。',
    followAtmosphere: true,
    dialog: [],
    hasBgm: false,
  },
  {
    id: 's8',
    cameraShot: '中景',
    angle: '平视',
    movement: '固定',
    sceneAssetId: 'scene2',
    duration: 5,
    moodTags: ['爆发', '紧张'],
    atmosphere: '室内顶灯，动作带出阴影。',
    followAtmosphere: true,
    dialog: [],
    hasBgm: true,
  },
  {
    id: 's9',
    cameraShot: '近景',
    angle: '仰视',
    movement: '固定',
    sceneAssetId: 'scene2',
    duration: 3,
    moodTags: ['隐忍', '沉默'],
    atmosphere: '从下往上拍，阿川表情克制。',
    followAtmosphere: true,
    dialog: [],
    hasBgm: false,
  },
  {
    id: 's10',
    cameraShot: '远景',
    angle: '平视',
    movement: '固定',
    sceneAssetId: 'scene2',
    duration: 6,
    moodTags: ['疏离', '夜色'],
    atmosphere: '窗外夜景，与室内冷暖对比。',
    followAtmosphere: true,
    dialog: [],
    hasBgm: true,
  },
  {
    id: 's11',
    cameraShot: '中景',
    angle: '侧面',
    movement: '固定',
    sceneAssetId: 'scene2',
    duration: 5,
    moodTags: ['决绝', '离开'],
    atmosphere: '背对镜头，门口逆光轮廓。',
    followAtmosphere: true,
    dialog: [],
    hasBgm: true,
  },
  {
    id: 's12',
    cameraShot: '特写',
    angle: '平视',
    movement: '固定',
    sceneAssetId: 'scene2',
    duration: 2,
    moodTags: ['犹豫', '细节'],
    atmosphere: '门把手特写，手部微动。',
    followAtmosphere: true,
    dialog: [],
    hasBgm: false,
  },
  {
    id: 's13',
    cameraShot: '中景',
    angle: '平视',
    movement: '固定',
    sceneAssetId: 'scene2',
    duration: 4,
    moodTags: ['分离', '光影'],
    atmosphere: '门开，走廊暖光与室内冷光交织。',
    followAtmosphere: true,
    dialog: [],
    hasBgm: true,
  },
  {
    id: 's14',
    cameraShot: '近景',
    angle: '俯视',
    movement: '固定',
    sceneAssetId: 'scene2',
    duration: 7,
    moodTags: ['孤独', '沉默'],
    atmosphere: '阿川独坐，顶灯拉长影子。',
    followAtmosphere: true,
    dialog: [],
    hasBgm: true,
  },
  {
    id: 's15',
    cameraShot: '远景',
    angle: '平视',
    movement: '拉镜',
    sceneAssetId: 'scene2',
    duration: 6,
    moodTags: ['余韵', '空荡'],
    atmosphere: '全屋收尾，风扇、半掩的门，留白。',
    followAtmosphere: true,
    dialog: [],
    hasBgm: true,
  },
]

export const assets: Asset[] = [
  {
    id: 'actor1',
    type: 'actor',
    name: '女主·小雨（现实主义）',
    description: '25岁互联网运营，略疲惫但眼神坚定，短发，素颜偏真实。',
    thumbnail: '/mock/assets/actor-xiaoyu.jpg',
    tags: ['现实主义', '都市', '女主'],
    promptTemplateId: 'pt_role_xiaoyu',
  },
  {
    id: 'actor2',
    type: 'actor',
    name: '男主·阿川（现实主义）',
    description: '27岁摄影师，戴金属框眼镜，常穿宽松卫衣。',
    thumbnail: '/mock/assets/actor-achuan.jpg',
    tags: ['现实主义', '都市', '男主'],
    promptTemplateId: 'pt_role_achuan',
  },
  {
    id: 'scene1',
    type: 'scene',
    name: '城郊老旧小区夜景',
    description: '八十年代老小区，外墙斑驳，路灯昏黄，远处有高架桥车流光轨。',
    thumbnail: '/mock/assets/scene-old-community.jpg',
    tags: ['夜景', '现实主义', '城郊'],
  },
  {
    id: 'scene2',
    type: 'scene',
    name: '十平米出租屋',
    description: '不足十平米的出租房，上下铺，杂物堆满，唯一的窗户对着防盗窗。',
    thumbnail: '/mock/assets/scene-rent-room.jpg',
    tags: ['室内', '压抑', '出租屋'],
  },
  {
    id: 'prop1',
    type: 'prop',
    name: '泛黄欠条',
    description: '被反复折叠的纸质欠条，上面有手写借款金额和签名。',
    thumbnail: '/mock/assets/prop-debt-note.jpg',
    tags: ['纸质', '细节特写'],
  },
]

export const promptTemplates: PromptTemplate[] = [
  {
    id: 'pt_frame_head_city',
    category: 'frame_head',
    name: '城市夜景开场远景',
    preview: '远景俯视城市夜景，霓虹灯与车流光轨交织……',
    content:
      '【远景】【{city_name}夜景】俯视视角，城市主干道与老旧小区同框，雨后路面反射霓虹灯，整体偏低饱和度，电影级灯光，写实风格。',
    variables: ['city_name'],
  },
  {
    id: 'pt_role_xiaoyu',
    category: 'role',
    name: '女主·小雨角色提示词',
    preview: '25岁互联网女生，略疲惫但眼神坚定……',
    content:
      '25岁东亚女性，短发，素颜偏真实，身材偏瘦，穿廉价居家服，背景为狭窄出租屋，现实主义写实风格，镜头重点刻画眼神细节。',
    variables: [],
  },
  {
    id: 'pt_bgm_subtle',
    category: 'bgm',
    name: '克制型城市情绪配乐',
    preview: '钢琴与环境音结合，偏克制、不过度煽情……',
    content:
      '低频钢琴与轻微环境噪音混合，节奏缓慢，避免大幅度旋律起伏，整体克制，突出角色内心波动而非煽情。',
    variables: [],
  },
  {
    id: 'pt_combined_chapter_init',
    category: 'combined',
    name: '章节综合提示词·现实都市',
    preview: '自动拼接角色、场景和氛围提示词……',
    content:
      '根据章节概要生成首尾关键帧描述，自动拼接项目统一风格、主角角色提示词、核心场景与情绪关键字，确保整集画面语言统一且呼应项目视觉调性。',
    variables: ['chapter_summary'],
  },
]

export const files: FileItem[] = [
  {
    id: 'f1',
    type: 'image',
    name: 'p1-c1-s1-城市夜景首帧',
    thumbnail: '/mock/files/p1-c1-s1-head.jpg',
    tags: ['首帧', '城市夜景', '现实主义'],
    createdAt: '2026-03-01 14:35',
    projectId: 'p1',
    chapterId: 'c1',
  },
  {
    id: 'f2',
    type: 'video',
    name: 'p1-c1-剪辑版本-v1',
    thumbnail: '/mock/files/p1-c1-edit-v1.jpg',
    tags: ['成片', '版本1'],
    createdAt: '2026-03-02 10:12',
    projectId: 'p1',
    chapterId: 'c1',
  },
  {
    id: 'f3',
    type: 'image',
    name: 'p2-c3-s1-霓虹街口首帧',
    thumbnail: '/mock/files/p2-c3-s1.jpg',
    tags: ['首帧', '科幻', '赛博朋克'],
    createdAt: '2026-02-27 11:00',
    projectId: 'p2',
    chapterId: 'c3',
  },
  {
    id: 'f4',
    type: 'video',
    name: 'p2-c3-成片',
    thumbnail: '/mock/files/p2-c3-video.jpg',
    tags: ['成片', '科幻'],
    createdAt: '2026-02-28 09:20',
    projectId: 'p2',
    chapterId: 'c3',
  },
  {
    id: 'f5',
    type: 'image',
    name: 'p4-c6-合租首帧',
    thumbnail: '/mock/files/p4-c6-s1.jpg',
    tags: ['首帧', '都市喜剧'],
    createdAt: '2026-03-01 16:00',
    projectId: 'p4',
    chapterId: 'c6',
  },
]

export const timelineClips: TimelineClip[] = [
  {
    id: 'tc1',
    type: 'video',
    sourceId: 'f2',
    label: '城市夜景开场',
    start: 0,
    end: 6,
    track: 1,
  },
  {
    id: 'tc2',
    type: 'audio',
    sourceId: 'bgm1',
    label: '克制型城市情绪配乐',
    start: 0,
    end: 20,
    track: 2,
  },
]

export const agents: Agent[] = [
  {
    id: 'agent1',
    name: '剧情提取Agent v2.1',
    type: 'plot',
    description: '基于GPT-4提取主线剧情，优化效率',
    isDefault: true,
    version: 'v2.1',
    updatedAt: '2026-03-05',
    createdAt: '2026-02-01',
    createdBy: 'extreme',
    updatedBy: 'extreme',
  },
  {
    id: 'agent2',
    name: '角色提取Agent v1.0',
    type: 'character',
    description: '从剧本中提取角色名称与关系',
    isDefault: true,
    version: 'v1.0',
    updatedAt: '2026-03-04',
    createdAt: '2026-02-10',
    createdBy: 'extreme',
    updatedBy: 'extreme',
  },
  {
    id: 'agent3',
    name: '场景提取Agent v1.2',
    type: 'scene',
    description: '识别场景切换与场景描述',
    isDefault: false,
    version: 'v1.2',
    updatedAt: '2026-03-03',
    createdAt: '2026-02-15',
    createdBy: 'extreme',
    updatedBy: 'extreme',
  },
  {
    id: 'agent4',
    name: '道具提取Agent v1.0',
    type: 'prop',
    description: '提取剧本中出现的道具与关键物品',
    isDefault: false,
    version: 'v1.0',
    updatedAt: '2026-03-02',
    createdAt: '2026-02-20',
    createdBy: 'extreme',
    updatedBy: 'extreme',
  },
  {
    id: 'agent5',
    name: '剧情提取Agent v2.0',
    type: 'plot',
    description: '旧版剧情提取，保留作对比',
    isDefault: false,
    version: 'v2.0',
    updatedAt: '2026-02-28',
    createdAt: '2026-01-25',
    createdBy: 'extreme',
    updatedBy: 'extreme',
  },
]

export const providers: Provider[] = [
  {
    id: 'prov1',
    name: 'OpenAI',
    base_url: 'https://api.openai.com/v1',
    description: '支持 GPT 系列模型',
    status: 'active',
    created_by: 'extreme',
  },
  {
    id: 'prov2',
    name: 'Anthropic',
    base_url: 'https://api.anthropic.com/v1',
    description: 'Claude 系列',
    status: 'active',
    created_by: 'extreme',
  },
  {
    id: 'prov3',
    name: '本地代理',
    base_url: 'http://localhost:8080/v1',
    description: '本地转发测试',
    status: 'testing',
    created_by: 'extreme',
  },
]

export const llmModels: Model[] = [
  {
    id: 'model1',
    name: 'GPT-4',
    category: 'text',
    provider_id: 'prov1',
    params: { max_tokens: 4096, temperature: 0.7 },
    description: '高性能文本生成模型',
    is_default: true,
    created_by: 'extreme',
  },
  {
    id: 'model2',
    name: 'GPT-3.5-turbo',
    category: 'text',
    provider_id: 'prov1',
    params: { max_tokens: 2048 },
    description: '通用文本模型',
    is_default: false,
    created_by: 'extreme',
  },
  {
    id: 'model3',
    name: 'Claude-3',
    category: 'text',
    provider_id: 'prov2',
    params: { max_tokens: 4096 },
    description: '长文本与推理',
    is_default: false,
    created_by: 'extreme',
  },
  {
    id: 'model4',
    name: 'DALL-E 3',
    category: 'image',
    provider_id: 'prov1',
    params: { resolution: '1024x1024' },
    description: '图片生成',
    is_default: true,
    created_by: 'extreme',
  },
  {
    id: 'model5',
    name: 'Sora',
    category: 'video',
    provider_id: 'prov1',
    params: {},
    description: '视频生成',
    is_default: true,
    created_by: 'extreme',
  },
]

export const defaultModelSettings: ModelSettings = {
  default_text_model_id: 'model1',
  default_image_model_id: 'model4',
  default_video_model_id: 'model5',
  api_timeout: 30,
  log_level: 'info',
}
