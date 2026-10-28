# 画布生成实现覆盖核对

本文件记录第19票的实现核对，不另设卡片或端点权威。运行时以公开 `CanvasCatalog`、具体卡片强类型、实例输出及保存／编译校验为准；测试结果、失败经过和环境限制见[19票](issues/19-integrated-creation-journey.md)。目录行不是独立物理卡片数量，关联不等于采用，关系出口不增加内容模态。

## 39行目录

以下逐行对照当前真实HTTP目录；对应票据保留各类型完整字段、编辑与生成验证。35个物理类型中摄影的五区域展开为五个入口，因此覆盖39行；本期没有音频模型生成。

| 分组 | 目录入口 | 实际类型／区域 | 模态 | 行为验证责任 |
| --- | --- | --- | --- | --- |
| 导演工具箱／画面设计 | 画面风格 | `direction.style` | text | [13](issues/13-visual-style-presets.md) |
| 导演工具箱／连续性与约束 | 空间规则 | `direction.space_rule` | text | [16](issues/16-continuity-facts.md) |
| 导演工具箱／连续性与约束 | 连续性设计 | `direction.continuity` | text | [16](issues/16-continuity-facts.md) |
| 导演工具箱／连续性与约束 | 不可改事实 | `direction.fact` | text | [16](issues/16-continuity-facts.md) |
| 导演工具箱／连续性与约束 | 创作控制 | `direction.creative_control` | text | [17](issues/17-creative-guidance-acceptance.md) |
| 导演工具箱／连续性与约束 | 生成指导 | `direction.guidance` | text | [17](issues/17-creative-guidance-acceptance.md) |
| 导演工具箱／连续性与约束 | 验收要求 | `direction.criterion` | text | [17](issues/17-creative-guidance-acceptance.md) |
| 导演工具箱／画面设计 | 景别与构图 | `direction.photography/composition` | text | [12](issues/12-photography-and-image-target.md) |
| 导演工具箱／画面设计 | 机位与视角 | `direction.photography/camera` | text | [12](issues/12-photography-and-image-target.md) |
| 导演工具箱／画面设计 | 运镜 | `direction.photography/movement` | text | [12](issues/12-photography-and-image-target.md) |
| 导演工具箱／画面设计 | 光影与色彩 | `direction.photography/lighting` | text | [12](issues/12-photography-and-image-target.md) |
| 导演工具箱／画面设计 | 焦点与成像 | `direction.photography/focus` | text | [12](issues/12-photography-and-image-target.md) |
| 导演工具箱／声音设计 | 对白 | `direction.dialogue` | text | [15](issues/15-dialogue-sound-design.md) |
| 导演工具箱／声音设计 | 声音安排 | `direction.sound` | text | [15](issues/15-dialogue-sound-design.md) |
| 导演工具箱／叙事与镜头 | 叙事概览 | `direction.narrative` | text | [14](issues/14-narrative-shot-design.md) |
| 导演工具箱／叙事与镜头 | 叙事节拍 | `direction.beat` | text | [14](issues/14-narrative-shot-design.md) |
| 导演工具箱／叙事与镜头 | 事件与刺激 | `direction.event` | text | [14](issues/14-narrative-shot-design.md) |
| 导演工具箱／叙事与镜头 | 镜头设计 | `direction.shot` | text | [14](issues/14-narrative-shot-design.md) |
| 导演工具箱／表演与调度 | 空间锚点 | `direction.anchor` | text | [11](issues/11-spatial-direction.md) |
| 导演工具箱／表演与调度 | 站位与走位 | `direction.blocking` | text | [11](issues/11-spatial-direction.md) |
| 导演工具箱／表演与调度 | 镜内活动 | `direction.activity` | text | [11](issues/11-spatial-direction.md) |
| 导演工具箱／表演与调度 | 环境活动与留白 | `direction.environment` | text | [11](issues/11-spatial-direction.md) |
| 导演工具箱／表演与调度 | 角色情境 | `direction.situation` | text | [10](issues/10-performance-direction.md) |
| 导演工具箱／表演与调度 | 人物表演 | `direction.performance` | text | [10](issues/10-performance-direction.md) |
| 导演工具箱／表演与调度 | 表演规则 | `direction.performance_rule` | text | [10](issues/10-performance-direction.md) |
| 基础内容 | 角色参考 | `reference.character` | image | [08](issues/08-named-image-references.md) |
| 基础内容 | 场所参考 | `reference.place` | image | [08](issues/08-named-image-references.md) |
| 基础内容 | 道具参考 | `reference.prop` | image | [08](issues/08-named-image-references.md) |
| 基础内容 | 服装参考 | `reference.costume` | image | [08](issues/08-named-image-references.md) |
| 基础内容 | 文本内容 | `content.text` | text | [01](issues/01-text-protocol-flow.md) |
| 基础内容 | 原文／创作依据 | `content.basis` | text | [01](issues/01-text-protocol-flow.md) |
| 基础内容 | 人物／物件描述 | `content.object` | text | [07](issues/07-object-description-identity.md) |
| 基础内容 | 场所描述 | `content.place` | text | [07](issues/07-object-description-identity.md) |
| 基础内容 | 图片内容 | `content.image` | image | [04](issues/04-media-content-outputs.md) |
| 基础内容 | 视频内容 | `content.video` | video | [04](issues/04-media-content-outputs.md) |
| 基础内容 | 音频内容 | `content.audio` | audio | [04](issues/04-media-content-outputs.md) |
| 模型生成 | 文本模型 | `model.text` | text | [01](issues/01-text-protocol-flow.md) |
| 模型生成 | 图片模型 | `model.image` | image | [05](issues/05-image-generation-adoption.md) |
| 模型生成 | 视频模型 | `model.video` | video | [06](issues/06-video-generation-inputs.md) |

## 28类输入端点

实际目录有30个物理输入标识；`attention_object`、`focus_object`是作用对象的具体用途，不额外计作逻辑端点。下表仅核对覆盖；每个接收方的值种类、类别、数量和字段资格仍分别校验。

| 逻辑用途 | 实际标识 | 关系分类 |
| --- | --- | --- |
| 文本依据 | `text` | 生成输入 |
| 参考图片 | `image` | 生成输入 |
| 首帧 | `first_frame` | 生成输入 |
| 尾帧 | `last_frame` | 生成输入 |
| 关键帧 | `key_frame` | 生成输入 |
| 主体图片参考 | `subject_image` | 生成输入 |
| 主体视频参考 | `subject_video` | 生成输入 |
| 名称关联 | `name` | 业务引用 |
| 参与对象 | `participant` | 业务引用 |
| 说话对象 | `speaker` | 业务引用 |
| 覆盖节拍 | `covered_beat` | 业务引用 |
| 所属节拍 | `beat` | 业务引用 |
| 关联事件 | `related_event` | 业务引用 |
| 变化事件 | `change_event` | 业务引用 |
| 接收事件 | `received_event` | 业务引用 |
| 触发事件 | `trigger_event` | 业务引用 |
| 位置锚点 | `position_anchor` | 业务引用 |
| 区域锚点 | `area_anchor` | 业务引用 |
| 调度依据 | `blocking_basis` | 业务引用 |
| 所属镜头 | `shot` | 业务引用 |
| 对白依据 | `dialogue_basis` | 业务引用 |
| 验收依据 | `acceptance_basis` | 业务引用 |
| 所属空间 | `space` | 业务引用 |
| 作用对象（含关注／焦点） | `effect_object`、`attention_object`、`focus_object` | 业务引用 |
| 图片来源 | `image_source` | 素材关联 |
| 图片素材 | `image_example` | 素材关联 |
| 视频素材 | `video_example` | 素材关联 |
| 音频素材 | `audio_example` | 素材关联 |

## 9行输出目录

| 规格输出 | 实际载荷／出口 | 边界核对 |
| --- | --- | --- |
| 通用文本、创作依据 | `TextOutputPayload`／`BasisTextOutputPayload`，text | 正文与只读来源／选区；定位不变成模型指令。 |
| 人物／物件、场所描述 | `DescriptionTextPayload`，text | 本卡描述与元数据；模型为直接采用的正文标注同一载荷的名称／稳定身份／类别，不反查或改写正文。 |
| 通用图片 | `MediaOutputPayload`，image | 一张有效文件；上传中／撤回保持不可用身份。 |
| 四类命名图片参考 | `NamedImagePayload`，image | 固定主图、已绑定对象、角度及位置；无描述正文。 |
| 通用视频 | `MediaOutputPayload`，video | 完整视频及原音轨，不隐式取帧。 |
| 通用音频 | `MediaOutputPayload`，audio | 原生播放，不转写、不跨级传输。 |
| 三类生成结果 | 当前发布位置／历史具体产物 | 逐项选择；另存为独立内容，输入集合不透传。 |
| 导演设计 | `DesignTextPayload`／`PhotographyTextPayload`，text | 默认整卡；摄影按声明范围；图片目标独立且完整设计保留。 |
| 业务对象引用 | object／anchor／blocking／beat／event／shot／dialogue／criterion | 独立强类型必要指代；对白只有ID／版本／说话对象，验收只有ID／名称，不带正文或媒体。 |

## 19行接收覆盖矩阵

| 接收分组（沿规格原行） | 实际承载 | 核对入口 |
| --- | --- | --- |
| 四类基础文本、通用图片／视频／音频 | content.text／basis／object／place／image／video／audio 无持续输入 | API／objects／Composer／media／旅程导入与重开 |
| 三类模型生成 | model.text／image／video 的真实能力用途 | images／video-bindings／Composer／旅程 |
| 四类命名图片参考 | name + image_source | named-references／multi-view／旅程 |
| 画面风格 | style 的图片／视频素材，不自动采用预设演示 | visual-presets／visual_style HTTP |
| 摄影五入口 | photography 单卡输入与 scope | photography／visual-presets／narrative |
| 锚点与空间规则 | anchor／space_rule 的 space／effect／示例 | spatial／continuity／字段定位HTTP |
| 角色情境 | situation 的 participant／effect | performance HTTP及页面 |
| 人物表演 | performance 的主体／节拍／事件／对白／验收／示例 | performance／sound／guidance／旅程 |
| 表演规则 | performance_rule 的 effect／示例 | performance HTTP及页面 |
| 站位与走位 | blocking 的主体／锚点／事件／示例 | spatial／narrative |
| 镜内活动 | activity 的主体／锚点／事件／作用对象／示例 | spatial／narrative |
| 环境活动与留白 | environment 的图片／视频示例 | spatial HTTP及页面 |
| 叙事概览、事件、控制、指导、验收 | narrative／event／creative_control／guidance／criterion | narrative／guidance；验收禁止反向使用关系 |
| 叙事节拍 | beat 的 related_event | narrative HTTP及页面 |
| 镜头设计 | shot 的主体／节拍／事件／调度／验收／示例 | narrative／guidance；节拍实际绑定顺序 |
| 对白 | dialogue 的 speaker／音视频示例 | sound／旅程；正文需模型独立采用 |
| 声音安排 | sound 的 effect／audio_example | sound；不新增声音生成 |
| 连续性设计 | continuity 的限定参与对象／事件／前后态素材 | continuity；前后态完整采用、固定产物 |
| 不可改事实 | fact 的限定作用对象／证据／来源定位 | continuity／facts HTTP；不做事实或图像真实性推断 |

## 19条规则

| 规则 | 现有公开行为验证 |
| --- | --- |
| 所有连线只提供候选 | named-references／spatial／guidance／journey 明确采用前无绑定。 |
| 候选不成为自身字段 | objects／named-references HTTP；直接输出不含候选正文。 |
| 文本与图片独立采用 | named-references／images／journey；参考不读取描述。 |
| 采用后自动名称映射 | multi-view／video-bindings／journey实际Worker请求。 |
| 三种用途统一无环 | API、performance、spatial、guidance HTTP及graph拖线。 |
| 只消费直接明确输出 | performance／narrative／sound／guidance／journey；对白跨级回归先红后绿。 |
| 逐级处理不整体透传 | mixed／journey；导演身份与媒体分别直接采用。 |
| 结果不形成回连环 | API DAG、mixed结果另存、journey下游仅消费独立图片。 |
| 明确关系与规范方向 | guidance三接收方，criterion只读actual bindings，禁止反向镜头。 |
| 按实际采用组织执行 | runs／mixed HTTP、target／runtime真实页面。 |
| 按单位及声明范围采用 | photography scope／frame target、整卡导演及生成结果逐项。 |
| 保留字段用途与状态 | performance／photography／continuity／guidance，纯文本不纠错。 |
| 关联内容需要直接采用 | sound／journey：对白正文、人物描述、媒体均不间接传入。 |
| 选择持续且局部有效 | autosave／photography／mixed，候选变化不扩大采用。 |
| 失效选择不静默替换 | references／mixed；journey精确目标用途断边，保留另一已采用用途。 |
| 冲突不静默覆盖 | photography／guidance／continuity：仅已知同目标状态硬要求。 |
| 无隐式转换 | media／video：原生音轨，不取帧、不转写、不新增音频模型。 |
| 当前输出与固定产物区分 | mixed／named-references／continuity／journey历史另存。 |
| 执行依据可核对与冻结 | runs／mixed／runtime／journey实际请求及历史；编辑不改已受理依据。 |

`selection` 真实页面要求隔离 MySQL，本地环境未配置时保留原guard并明示未执行，不能以SQLite冒充该竞争验证。其他实际页面结果、少量旧布局用例迁移及失败经过由19票按真实执行记录，以上用例名称不单独构成“全部通过”的声明。
