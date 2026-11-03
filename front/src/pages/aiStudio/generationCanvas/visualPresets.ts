import type { DesignField, CompositionDesignFields, CameraDesignFields, MovementDesignFields, LightingDesignFields, FocusDesignFields, StyleDesignFields } from '../../../services/generated'

type VisualPresetFields = CompositionDesignFields & CameraDesignFields & MovementDesignFields & LightingDesignFields & FocusDesignFields & StyleDesignFields

export type VisualPreset = { id: string; name: string; explanation: string; look: string; fields: Partial<VisualPresetFields>; video?: string }
const field = (text: string): DesignField => ({ text, state: 'proposal', purpose: 'design', source_locator: '' })
export const styleLabels: Record<keyof StyleDesignFields, string> = { direction: '风格方向', visual_features: '视觉特征', materials: '材质倾向', colors: '色彩倾向', notes: '自定义说明' }
export const stylePresets: VisualPreset[] = [
  { id:'watercolor',name:'手绘水彩',look:'watercolor',explanation:'半透明叠色、自然晕染与纸张颗粒。',fields:{direction:field('手绘水彩'),visual_features:field('柔和边缘、半透明叠色、自然晕染'),materials:field('水彩颜料与纸张颗粒'),colors:field('低饱和青绿与暖色点缀')} },
  { id:'animation',name:'立体动画',look:'animation',explanation:'圆润体积、干净材质与柔和光照。',fields:{direction:field('立体动画'),visual_features:field('圆润造型、清楚体积、柔和阴影'),materials:field('平滑哑光材质'),colors:field('明快暖色与冷色背景')} },
  { id:'noir',name:'黑白光影',look:'noir',explanation:'高反差明暗、克制灰阶与轮廓光。',fields:{direction:field('黑白光影'),visual_features:field('高反差明暗与清晰轮廓'),materials:field('细腻胶片颗粒'),colors:field('黑白灰阶')} },
]
export const photographyPresets: Record<string, VisualPreset[]> = {
  composition:[
    {id:'close',name:'特写景别',look:'close',explanation:'紧密观察主体局部，强调细节。',fields:{shot_size:{...field('特写'),size:'close_up'}}},
    {id:'wide',name:'远景景别',look:'wide',explanation:'主体较小，保留环境空间与位置关系。',fields:{shot_size:{...field('远景'),size:'wide'}}},
    {id:'thirds',name:'三分构图',look:'thirds',explanation:'主体位于三分交点，另一侧留出空间。',fields:{composition:field('主体置于三分交点'),frame_position:field('主体偏右，左侧留白'),negative_space:field('为视线方向保留空间')}},
    {id:'center',name:'居中对称',look:'center',explanation:'主体居中，左右空间平衡。',fields:{composition:field('居中对称构图'),frame_position:field('主体居中'),negative_space:field('左右均衡留白')}}],
  camera:[
    {id:'eye',name:'平视机位',look:'eye',explanation:'视点与主体等高，平稳观察。',fields:{viewpoint:field('平视观察主体'),height_angle:field('视线等高、水平角度')}},
    {id:'low',name:'低机位仰视',look:'low',explanation:'从较低位置观察，强化向上的透视。',fields:{viewpoint:field('从较低视点观察主体'),height_angle:field('低机位向上仰拍'),lens_effect:field('适度强化向上透视')}}],
  movement:[
    {id:'push',name:'缓慢推进',look:'push',explanation:'摄影机沿视轴靠近，主体占画面比例逐步增大。',video:'/canvas-presets/push.mp4',fields:{movement_type:field('缓慢推进'),movement_path:field('沿视轴向主体靠近'),movement_speed:field('平稳缓慢')}},
    {id:'pan',name:'横向平移',look:'pan',explanation:'摄影机水平移动，背景与主体横向关系改变。',video:'/canvas-presets/pan.mp4',fields:{movement_type:field('横向平移'),movement_path:field('沿水平路径向右平移'),movement_speed:field('匀速平稳')}}],
  lighting:[
    {id:'side',name:'侧光塑形',look:'side',explanation:'单侧主光形成明确的明暗层次。',fields:{light_direction:field('侧向主光'),light_regions:field('主体一侧明亮，另一侧保留阴影')}},
    {id:'soft',name:'柔和漫射',look:'soft',explanation:'大面积柔光降低明暗反差。',fields:{light_sources:field('大面积柔和漫射光源'),light_regions:field('均匀柔和，保留细腻层次')}}],
  focus:[
    {id:'shallow',name:'浅景深',look:'shallow',explanation:'主体清晰、背景虚化，突出观看重点。',fields:{depth_focus:field('浅景深，焦点锁定主体，背景柔和虚化')}},
    {id:'deep',name:'深景深',look:'deep',explanation:'前后景均保持可辨认的空间细节。',fields:{depth_focus:field('深景深，前景主体与背景空间保持清晰')}}],
}
/** 只修改预设所声明的字段；关系、示例、其他区域与自定义说明保持原值。 */
export function applyPreset<T extends VisualPresetFields>(fields: T, preset: VisualPreset): T {
  return { ...fields, ...Object.fromEntries(Object.entries(preset.fields).map(([key, value]) => [key, { ...fields[key as keyof T], ...value, ...('document' in (fields[key as keyof T] || {}) ? { document: null } : {}) }])) }
}
