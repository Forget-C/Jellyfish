/**
 * 资产资料（`chapter_asset_profiles`）的**可编辑字段表**与名称匹配口径。
 *
 * 为什么要单独一个模块：字段键与中文标签必须和后端
 * `app/services/studio/asset_profiles.py::PROFILE_FIELD_SPECS` **逐字一致**
 * （后端是字段表的唯一事实来源，前端只是把它画成表单）。一致性由后端一条测试
 * （`tests/test_asset_profile_fields_contract.py`）读这个文件逐项比对，防止两边漂移。
 *
 * 用户口径（这一轮明确点名要能编辑的字段，全部包含在下面）：
 * - 角色：性别年龄、外貌、发型、性格气质、服装配饰（+ 身份/关系/时代/相关剧情）；
 * - 场景：空间结构、陈设、时间天气、光线色调、氛围（+ 时代地点/室内外/相关事件）；
 * - 道具：材质、形状、尺寸、状态、所属人物或场景、剧情作用（+ 颜色/用途）；
 * - 服装：穿着人物、身份时代、款式、颜色、材质、配饰、使用场合。
 */

export type AssetProfileFieldType =
  | 'character'
  | 'scene'
  | 'prop'
  | 'costume'
  | 'product'

export type AssetProfileFieldSpec = {
  /** 后端字段键（`manual_overrides` 里的键） */
  key: string
  /** 用户看得懂的中文标签（与后端 `field_label` 一致） */
  label: string
  /** 输入框提示（教用户怎么写才有用，不写空话） */
  placeholder: string
  /** 是不是"画面硬特征"（后端 `visual=True`）：出图质量拦截认的就是这些字段 */
  visual: boolean
}

export const ASSET_PROFILE_FIELD_SPECS: Record<AssetProfileFieldType, AssetProfileFieldSpec[]> = {
  character: [
    { key: 'identity', label: '身份', placeholder: '例：将军府庶女', visual: true },
    { key: 'relations', label: '关系', placeholder: '例：秦老夫人的孙女', visual: true },
    { key: 'gender_age', label: '性别年龄', placeholder: '例：女，十六岁', visual: true },
    { key: 'era', label: '时代', placeholder: '例：架空古代（唐风）', visual: true },
    { key: 'appearance', label: '外貌', placeholder: '例：鹅蛋脸杏眼，唇色偏淡', visual: true },
    { key: 'hairstyle', label: '发型', placeholder: '例：双环髻，垂两缕碎发', visual: true },
    {
      key: 'costume_accessories',
      label: '服装配饰',
      placeholder: '例：素白襦裙，腰间垂羊脂玉佩',
      visual: true,
    },
    { key: 'personality', label: '性格气质', placeholder: '例：隐忍克制，指节发白', visual: true },
    { key: 'related_plot', label: '相关剧情', placeholder: '例：跪在听雨轩青砖地上，把匕首藏在袖中', visual: false },
    { key: 'shot_refs', label: '出场镜头', placeholder: '例：#1、#2（一般不用手填）', visual: false },
  ],
  scene: [
    { key: 'era_location', label: '时代地点', placeholder: '例：古代将军府临水小轩', visual: true },
    { key: 'indoor_outdoor', label: '室内外', placeholder: '例：内景', visual: true },
    { key: 'time_weather', label: '时间天气', placeholder: '例：夜，秋雨', visual: true },
    {
      key: 'spatial_structure',
      label: '空间结构',
      placeholder: '例：三开间厅堂，正中摆乌木太师椅',
      visual: true,
    },
    { key: 'furnishings', label: '陈设', placeholder: '例：青铜烛台、青砖地面、暗红帷幔', visual: true },
    { key: 'light_tone', label: '光线色调', placeholder: '例：烛火暖黄，明暗对比强', visual: true },
    { key: 'atmosphere', label: '氛围', placeholder: '例：雨声与穿堂风，压抑克制', visual: true },
    { key: 'related_events', label: '相关事件', placeholder: '例：两人隔灯对峙、逼问嫁妆', visual: false },
  ],
  prop: [
    { key: 'material', label: '材质', placeholder: '例：乌木', visual: true },
    { key: 'color', label: '颜色', placeholder: '例：乌黑发亮', visual: true },
    { key: 'shape', label: '形状', placeholder: '例：杖首雕兽，杖身笔直', visual: true },
    { key: 'size', label: '尺寸', placeholder: '例：长约一米，成人齐腰', visual: true },
    { key: 'state', label: '状态', placeholder: '例：常年摩挲，握处包浆', visual: true },
    { key: 'usage', label: '用途', placeholder: '例：拄行', visual: true },
    { key: 'owner', label: '所属人物或场景', placeholder: '例：秦老夫人', visual: true },
    { key: 'plot_role', label: '剧情作用', placeholder: '例：逼问嫁妆时的威压道具', visual: false },
  ],
  costume: [
    { key: 'wearer', label: '穿着人物', placeholder: '例：秦老夫人', visual: true },
    { key: 'identity_era', label: '身份时代', placeholder: '例：古代将军府主母', visual: true },
    { key: 'style', label: '款式', placeholder: '例：立领对襟长褙子', visual: true },
    { key: 'color', label: '颜色', placeholder: '例：深黛底织金', visual: true },
    { key: 'material', label: '材质', placeholder: '例：织锦缎，暗纹提花', visual: true },
    { key: 'accessories', label: '配饰', placeholder: '例：翡翠手串、白玉簪', visual: true },
    { key: 'occasion', label: '使用场合', placeholder: '例：堂前逼问嫁妆的正装场合', visual: true },
  ],
  product: [
    { key: 'appearance', label: '外观描述', placeholder: '例：白色磨砂塑料瓶身，金色压泵，正面印品牌名', visual: true },
    { key: 'material', label: '材质', placeholder: '例：磨砂 PET 塑料，金属压泵', visual: true },
    { key: 'color', label: '颜色', placeholder: '例：主色纯白，辅色香槟金', visual: true },
    { key: 'package', label: '包装', placeholder: '例：方形瓶身 + 白色外盒，盒面有烫金线', visual: true },
    { key: 'logo', label: 'Logo与品牌标识', placeholder: '例：瓶身正面居中金色字标，不得改动字形与位置', visual: true },
    { key: 'spec', label: '规格', placeholder: '例：净含量 100ml，瓶高 16cm', visual: false },
    { key: 'selling_points', label: '关联卖点', placeholder: '例：三秒吸收不黏腻、孕妇可用', visual: false },
  ],
}

export function profileFieldSpecs(type: string): AssetProfileFieldSpec[] {
  return ASSET_PROFILE_FIELD_SPECS[type as AssetProfileFieldType] ?? []
}

export function profileFieldLabel(type: string, key: string): string {
  return profileFieldSpecs(type).find((spec) => spec.key === key)?.label ?? key
}

/**
 * 名称归一：与后端 `llm_orchestration.json_utils.normalize_name` 同一口径
 * （全角转半角 → 去所有空白 → 小写），用来把页面上的资产与资料行对上。
 */
export function normalizeAssetName(value: string): string {
  const text = String(value ?? '')
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .trim()
  return text.replace(/\s+/g, '').toLowerCase()
}

export type AssetProfileRecordLike = {
  id: number
  asset_type: string
  name: string
  name_key?: string
}

/** 在资料行列表里找这条资产对应的那一行（先按规范名，再按显示名兜底）。 */
export function findRecordForAsset<T extends AssetProfileRecordLike>(
  records: readonly T[],
  asset: { type: string; name: string },
): T | undefined {
  const key = normalizeAssetName(asset.name)
  return (
    records.find(
      (record) =>
        record.asset_type === asset.type && (record.name_key || normalizeAssetName(record.name)) === key,
    ) ?? records.find((record) => record.asset_type === asset.type && record.name === asset.name)
  )
}
