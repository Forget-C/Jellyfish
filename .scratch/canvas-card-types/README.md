# 画布生成优化：任务索引

日期：2026-10-29

依据[实现规格](spec.md)及已确认的 Q16–Q23 共识，用户已确认以下 19 张纵向票据和阻塞关系，并于 2026-10-28 授权使用 implement-spec 在 codex-generation-canvas 分支完成全部实现。ready-for-agent 表示分诊状态，不表示票据已完成。规格及票据中此前“本轮不开始实现”等表述记录规格发布阶段，现由本次实现授权接续；不扩大原有业务范围。

**2026-10-29 规格增补（20–26 实施中）：**用户确认生成画布须完全遵循场次工作台的布局、样式与基本交互，不强制组件复用，保持卡片、端点、采用及生成规则不变，并补充同尺寸真实页面视觉对照和交互验收。详见[页面布局与卡片交互](spec.md#与场次工作台一致的页面布局)及[验收增补](spec.md#本次布局视觉与交互验收增补)。下方 01–19 集成状态与历史验证保持原记录，不代表该增补已验收；用户已确认下方七张新增票据及其依赖，并明确授权使用 implement-spec 在当前 codex-generation-canvas 分支按依赖图落地及验收。

每张票据覆盖一个可观察的完整行为：数据契约、后端处理、前端操作及相应行为验证共同交付，优先复用已有生成、任务、历史和恢复能力。01 在既有文本生成路径中完成必要公共重构；02 在真实独立页面中完成必要外壳提取，不另设仅搭底层框架的票据。

## 任务与阻塞关系

编号表示依赖顺序，不要求严格串行执行。01–19 共十九票已实现并集成，最终规范／规格双轴审查及修复复核均已完成，两轴剩余发现均为 0。实际覆盖见[实现核对](implementation-coverage.md)，验证证据和环境限制在下方及相应票据维护。

| 票据 | Blocked by | 目录负责内容 |
| --- | --- | --- |
| [01 新协议下的文本生成闭环](issues/01-text-protocol-flow.md) | 无 | 通用文本、原文／创作依据、文本生成 |
| [02 项目入口与独立工作台页面](issues/02-standalone-workbench-page.md) | 无 | 跨类型行为，见票据完成条件 |
| [03 约 1 秒自动保存与下游刷新](issues/03-autosave-output-refresh.md) | 01 | 跨类型行为，见票据完成条件 |
| [04 基础媒体导入与明确输出](issues/04-media-content-outputs.md) | 01 | 通用图片、通用视频、通用音频 |
| [05 图片生成与结果选择](issues/05-image-generation-adoption.md) | 04 | 图片生成 |
| [06 视频生成的用途与实际采用](issues/06-video-generation-inputs.md) | 04 | 视频生成 |
| [07 人物／物件与场所描述](issues/07-object-description-identity.md) | 01 | 人物／物件、场所 |
| [08 四类命名图片参考](issues/08-named-image-references.md) | 05、07 | 角色参考、场所参考、道具参考、服装参考 |
| [09 多角度参考与视频名称映射](issues/09-multi-view-video-mapping.md) | 06、08 | 跨类型行为，见票据完成条件 |
| [10 人物表演与情境生成](issues/10-performance-direction.md) | 06、08 | 角色情境、人物表演、表演规则 |
| [11 空间锚点与空间调度](issues/11-spatial-direction.md) | 10 | 空间锚点、站位与走位、镜内活动、环境活动与留白 |
| [12 摄影设计与图片目标状态](issues/12-photography-and-image-target.md) | 10 | 景别与构图、机位与视角、运镜、光影与色彩、焦点与成像 |
| [13 画面风格与可视化预设](issues/13-visual-style-presets.md) | 12 | 画面风格 |
| [14 叙事与镜头设计](issues/14-narrative-shot-design.md) | 11 | 叙事概览、叙事节拍、事件与刺激、镜头设计 |
| [15 对白与声音设计](issues/15-dialogue-sound-design.md) | 10 | 对白、声音安排 |
| [16 空间规则、连续性与不可改事实](issues/16-continuity-facts.md) | 14 | 空间规则、连续性设计、不可改事实 |
| [17 创作控制、生成指导与验收要求](issues/17-creative-guidance-acceptance.md) | 12、14 | 创作控制、生成指导、验收要求 |
| [18 混合管道运行与引用生命周期](issues/18-mixed-pipeline-lifecycle.md) | 03、09、10 | 跨类型行为，见票据完成条件 |
| [19 完整创作旅程与复用边界收口](issues/19-integrated-creation-journey.md) | 02、13、15、16、17、18 | 跨类型行为，见票据完成条件 |

## 依赖图

```mermaid
flowchart TD
  T1["01 新协议下的文本生成闭环"]
  T2["02 项目入口与独立工作台页面"]
  T3["03 约 1 秒自动保存与下游刷新"]
  T4["04 基础媒体导入与明确输出"]
  T5["05 图片生成与结果选择"]
  T6["06 视频生成的用途与实际采用"]
  T7["07 人物／物件与场所描述"]
  T8["08 四类命名图片参考"]
  T9["09 多角度参考与视频名称映射"]
  T10["10 人物表演与情境生成"]
  T11["11 空间锚点与空间调度"]
  T12["12 摄影设计与图片目标状态"]
  T13["13 画面风格与可视化预设"]
  T14["14 叙事与镜头设计"]
  T15["15 对白与声音设计"]
  T16["16 空间规则、连续性与不可改事实"]
  T17["17 创作控制、生成指导与验收要求"]
  T18["18 混合管道运行与引用生命周期"]
  T19["19 完整创作旅程与复用边界收口"]
  T1 --> T3
  T1 --> T4
  T4 --> T5
  T4 --> T6
  T1 --> T7
  T5 --> T8
  T7 --> T8
  T6 --> T9
  T8 --> T9
  T6 --> T10
  T8 --> T10
  T10 --> T11
  T10 --> T12
  T12 --> T13
  T11 --> T14
  T10 --> T15
  T14 --> T16
  T12 --> T17
  T14 --> T17
  T3 --> T18
  T9 --> T18
  T10 --> T18
  T2 --> T19
  T13 --> T19
  T15 --> T19
  T16 --> T19
  T17 --> T19
  T18 --> T19
```

- 初始可开始的票据是 01、02；01 完成后，03、04、07 可独立推进。
- 04 提供导入媒体后，05 图片与 06 视频可并行；视频不依赖图片生成。
- 06、08 完成后，09 多角度与 10 表演可独立推进；表演不要求先具备多角度参考。
- 10 完成后，11 空间、12 摄影、15 声音可独立推进。14 需要 11 的真实调度来源；16 通过 14 已依赖 11，不重复列阻塞边。
- 18 只依赖其混合链路所需的保存、参考和表演能力，不等待全部导演目录。19 汇合页面、各内容分支与混合执行。
- 依赖只表达功能上必须先具备的能力；修改相同公共契约时仍须协调集成，不由本索引授权新建其他任务会话。

## 布局对齐增补（20–26）

本组接续原编号，不改写 01–19 的完成状态、验收勾选或实施记录。共 7 张新票，分诊均为 ready-for-agent；用户已授权本组实施。20 已集成，当前依赖前沿为21、22、23、25；具体完成状态与证据以各票 Completion／Comments 为准。原票已集成作为现有基础，不重复列为尚待完成的阻塞。

| 票据 | Blocked by | 独立交付行为 |
| --- | --- | --- |
| [20 完整画布布局与顶部菜单对齐](issues/20-workbench-chrome-alignment.md) | 无 | 完整页面与顶部管理、保存、生成及记录入口 |
| [21 悬浮面包屑与筛选闭环](issues/21-floating-navigation-filters.md) | 20 | 真实浏览范围、展示筛选及隐藏来源后的输入核对 |
| [22 左侧卡片列表与添加操作](issues/22-card-list-addition.md) | 20 | 三组目录搜索、点击／拖入、编辑保存重开 |
| [23 卡片阅读、选择与右侧编辑闭环](issues/23-card-reading-inspector.md) | 20 | 卡片摘要／媒体／模型状态、选择与稳定详情编辑 |
| [24 边缘端点、候选连接与明确采用](issues/24-edge-ports-candidate-adoption.md) | 23 | 边缘端点、候选连接、明确采用及实际输入核对 |
| [25 底部工具、小地图与历史操作对齐](issues/25-canvas-tools-history.md) | 20 | 视图工具、分组、小地图及独立历史操作 |
| [26 完整创作旅程与视觉交互验收收口](issues/26-visual-interaction-journey.md) | 21、22、24、25 | 完整旅程、跨区域稳定性及成对视觉验收 |

```mermaid
flowchart TD
  T20["20 完整画布布局与顶部菜单"]
  T21["21 悬浮导航与筛选"]
  T22["22 卡片列表与添加"]
  T23["23 卡片阅读、选择与详情"]
  T24["24 端点、候选与采用"]
  T25["25 底部工具与历史"]
  T26["26 完整旅程与视觉交互验收"]
  T20 --> T21
  T20 --> T22
  T20 --> T23
  T20 --> T25
  T23 --> T24
  T21 --> T26
  T22 --> T26
  T24 --> T26
  T25 --> T26
```

- 20 完成真实页面布局和浮层宿主后，21、22、23、25 可独立推进；24 需要 23 的稳定卡壳、事件及详情边界。26 汇合四个分支，23 已经通过 24 形成传递依赖，不重复列边。
- 每票包含自身可观察闭环与验收，不单拆主题、公共组件、后端或测试层；不强制抽公共外壳。必要预重构在所属票内先完成，并立即接入真实行为。
- 完全遵循场次工作台的布局、样式与基本交互；组件只在符合功能规划与契约时复用。三组目录、四种模态、逻辑端点、候选不自动采用、一级传输、统一无环、独立采用及生成规则保持不变。
- 每票按影响提供真实页面及桌面／窄屏视觉证据，既有 HTTP 接口核对保存、绑定、预检或实际请求等相关行为；供应商和外部存储使用受控替身。26 补齐跨票组合、同尺寸成对截图与整体覆盖，不替代前面各票验收。
- 分工边界：20 负责顶部与操作／记录容器，21 负责浏览导航和展示筛选，22 负责添加列表，23 负责卡片与详情，24 负责端点及关系状态，25 负责视图工具和独立历史。修改相同页面时协调集成，不把文件重叠机械转换成额外阻塞。
- 发布阶段只新增本组七票及索引；当前已进入授权实施，按实际交付同步各新票与受影响的实现事实文档，不改写原票和历史证据，也不预填通过结果。

## 目录覆盖

39 行目录分配如下。功能入口不等于独立物理卡片、表或处理器；摄影的五项入口仍维护同一张摄影内容卡。

| 分组 | 数量 | 负责票据 |
| --- | --- | --- |
| 基础内容 | 11 | 01：通用文本、原文／创作依据；04：图片、视频、音频；07：人物／物件、场所；08：四类命名图片参考。 |
| 模型生成 | 3 | 01：文本；05：图片；06：视频。 |
| 导演工具箱／画面设计 | 6 | 12：构图、机位、运镜、光影、焦点五入口；13：独立风格及可视化预设。 |
| 导演工具箱／表演与调度 | 7 | 10：角色情境、人物表演、表演规则；11：空间锚点、站位与走位、镜内活动、环境活动与留白。 |
| 导演工具箱／叙事与镜头 | 4 | 14：叙事概览、叙事节拍、事件与刺激、镜头设计。 |
| 导演工具箱／声音设计 | 2 | 15：对白、声音安排。 |
| 导演工具箱／连续性与约束 | 6 | 16：空间规则、连续性设计、不可改事实；17：创作控制、生成指导、验收要求。 |

## 端点与跨票关系责任

28 类输入端点沿规格的 7 类生成输入、17 类业务引用、4 类素材关联分配。来源与接收方可以先后交付：先交付方声明完整契约，已有来源即可形成真实可用闭环；后续来源或接收方接入时沿同一契约工作，不伪造候选、占位处理器或必填关系。可选的镜头、节拍等关系不成为独立工具生成的前置条件。

| 关系类别 | 端点 | 负责票据 |
| --- | --- | --- |
| 生成输入 | 文本依据 | 01；05、06 接入对应模型，10–17 扩展结构化来源 |
| 生成输入 | 参考图片 | 05；08、09 扩展命名参考 |
| 生成输入 | 首帧 | 06；09 扩展命名参考 |
| 生成输入 | 尾帧 | 06；09 扩展命名参考 |
| 生成输入 | 关键帧 | 06；09 扩展命名参考 |
| 生成输入 | 主体图片参考 | 06；09 扩展对象身份与多角度 |
| 生成输入 | 主体视频参考 | 06 |
| 业务引用 | 名称关联 | 08；09 扩展另一角度参考 |
| 业务引用 | 参与对象 | 10；11、14、16 扩展接收方 |
| 业务引用 | 说话对象 | 15 |
| 业务引用 | 覆盖节拍 | 14 |
| 业务引用 | 所属节拍 | 10 声明接收；14 提供来源并接通 |
| 业务引用 | 关联事件 | 14；16 扩展连续性接收 |
| 业务引用 | 变化事件 | 11 声明接收；14 提供来源并接通 |
| 业务引用 | 接收事件 | 10 声明接收；14 提供来源并接通 |
| 业务引用 | 触发事件 | 11 声明接收；14 提供来源并接通 |
| 业务引用 | 位置锚点 | 11 |
| 业务引用 | 区域锚点 | 11 |
| 业务引用 | 调度依据 | 11 提供来源；14 接收 |
| 业务引用 | 所属镜头 | 12 声明接收；14 提供来源；19 核对组合 |
| 业务引用 | 对白依据 | 10 声明接收；15 提供来源并接通 |
| 业务引用 | 验收依据 | 10、12、14 声明接收；17 提供来源并接通 |
| 业务引用 | 所属空间 | 11；16 扩展空间规则接收 |
| 业务引用 | 作用对象 | 10–17 按各类型字段资格分别接入 |
| 素材关联 | 图片来源 | 08 |
| 素材关联 | 图片素材 | 10；后续导演票据按字段声明扩展 |
| 素材关联 | 视频素材 | 10；12、15 等按字段声明扩展 |
| 素材关联 | 音频素材 | 15；其他类型仅按规格声明开放 |

所属镜头等双方可独立推进的关系，以及其他导演类型与图片目标选择的组合，在 19 核对双方实际可用；单票不能把尚未交付的组合记录为已验证。12 负责图片目标选择交互，其他类型按声明提供明确状态，保持完整采用，不为此复制目标选择逻辑或解析自由文本。

9 行输出目录由内容所属票据同步交付：01 提供通用文本及文本结果，07 提供描述与对象引用，04 提供普通媒体，05／06 提供相应模型结果，08 提供命名图片及对象引用，10–17 提供各自设计文本与声明的对象引用。19 按完整规格逐项核对输入、输出和 19 条连线规则，不能只比较目录总数。

## 各票共同完成边界

- 卡片自身内容、实际输入绑定和派生展示分别维护；连线只提供候选。三类候选关系统一无环，候选预览和实际处理都只消费直接出口的明确内容。
- 后端输出行为使用小型 Protocol，数据使用强类型契约；前端通过 OpenAPI generated client 使用公开接口，不重复定义另一份采用或名称映射权威。
- 每票同步保存、重开、候选／已采用展示、编译诊断及新增引用保护。基础无环、文件归属、失效绑定、删除保护与单卡运行随功能交付，不推迟到 18 或 19。
- 导演设计默认完整采用，人物表演不得拆项；摄影只开放契约声明的范围。对象引用逐对象、生成结果逐项选择，不因整卡采用扩选其他出口或结果集合。
- 选择阶段／状态只针对导演输出明确提供的结构，在图片端作为画面目标；完整设计仍被采用，不从普通文字推断阶段，不为目标选择新增导演字段。
- 编辑约每秒合并保存，成功后按修订刷新相关输出；无编辑不提交、在途串行、旧回执不覆盖新内容。保存和输出刷新不自动运行模型或采用候选。
- 预览、预设示例、素材关联、生成实际输入、历史结果与当前编辑分别表达；纯文本原样保留，不进行语义纠错或图像内容正确性检测。
- 既有运行、取消、幂等、恢复、文件保留与历史能力按新契约适配；内容复制／另存保持明确操作和只读来源，不新增回连或未来输出引用。
- 新增公共接口同步公开契约、OpenAPI 与前端生成类型，按仓库规则完成受影响检查；具体字段名、代码组织、路径及兼容迁移方案仍按规格在实现设计中确定，不因拆票默认执行迁移。
- 本期不改造章节、场次四画布或旧生产／剪辑业务，不新增音频生成、隐式转换、通用表单引擎或全场自动适用性系统。

## 完成条件与验证边界

票据中的未勾选条目是来自已确认规格的可观察完成条件，不是已经通过的验收证据。每个切片需要验证自己的外部行为，不能用其他类型的旧检查替代新行为，也不能把全部验证拖到 19。

用户于实现阶段确认测试接缝：现有画布 HTTP 接口覆盖保存、输出、绑定、编译和运行，真实页面覆盖编辑、采用、自动保存和布局；生成供应商与外部存储使用受控替身。HTTP 不证明交互正确，页面不证明真实供应商质量。仓库既有检查要求仍适用，按影响范围运行并记录实际证据、限制和未完成项，不预填通过结果。

原版任务与交付记录仅作为已有能力的证据，不改写、重开或重复发布旧票据；本索引不把这 19 张新增票据标成已交付。


## 实施记录

- 集成分支：codex-generation-canvas；实现前基线：66f32c19b2bb68eb494a18db6f429a9c874d5bc8。
- 当前进展：01–12、14、15、18 共十五票已合并到集成分支。16 已在独立工作树实现并验证、等待集成；13／17 进行中，19 等待这三票，完成证据见对应票据。
- implement-spec 要求实施子代理使用独立工作树并执行 TDD，合并后统一审查。用户已确认 HTTP 与真实页面接缝，生成供应商与外部存储使用受控替身；后续每票复用该确认执行 TDD，不重复询问。

- 2026-10-28：合并 codex-canvas-types-02（代码提交 9b14739，合并前分支 HEAD 6639d43），无冲突。复用票据中的真实页面验证证据，集成后 Node 24 前端 typecheck 与 git diff --check、git diff --cached --check 均通过；分诊 Status 保持不变。

- 2026-10-28：合并 codex-canvas-types-01（分支 HEAD 938a8607，集成提交 ce816fb0），无冲突，01 Completion 更新为 integrated，分诊 Status 保持不变。核实主区 8000 已加载新绑定／创作依据／schema v2 后执行完整 openapi:update，结果与交付契约一致；剔除 361 处纯尾空行漂移。Node 24 前端 typecheck、git diff --check 和 git diff --cached --check 均通过；复用 01 票据中同一实现的后端及真实页面检查。当前前沿为 03、04、07。

- 2026-10-28：03 在 codex-canvas-types-03 实现一秒周期合并保存、失败暂停与已保存 revision 的来源／正式输出／诊断刷新，等待集成。真实页面 autosave、既有 save、工作台六用例及前端 typecheck 通过，证据与限制见 03 票据；未改变公开 HTTP 契约。

- 2026-10-28：合并 codex-canvas-types-04（分支 HEAD `7d4ed6ad`，集成提交 `436691a2`），无冲突；04 Completion 更新为 integrated，分诊 Status 保持不变。复用 91 passed／27 skipped、Pylint 10.00/10 和真实 Chrome 媒体页面证据；主区 Node 24 typecheck 与差异检查通过。04 公开 schema 精确一致；本次 8000 无响应，未重复执行标准 OpenAPI 生成，复用 01 集成后已验证结果，不声称本次请求通过。当前前沿为 03、05、06、07，其中 03、07 进行中。

- 2026-10-28：依次合并03（分支HEAD `1b7d67a3`，合并 `edcea6fe`）及07（分支HEAD `9450b58d`，合并 `15fafb5a`），均无冲突，两票Completion更新为integrated，分诊Status保持不变。主区HTTP相关回归50 passed／7 deselected、Pylint10.00/10（缓存stats写入提示不影响exit0）、Node24.22.1 typecheck及真实autosave页面19.5s通过；证据 `/private/tmp/canvas0307-integrated`。07对象真实页面及workbench既有证据复用，未新增冲突不扩大验证。主区app导入路径已核实，独立8274导出OpenAPI与已提交schema精确一致，重新生成client仅365处尾空行漂移并已剔除；8000无响应且未操作，不声称本次标准openapi:update成功。MySQL专用7项未运行，外部供应商受控替身限制继续保留。当前05进行中、06可开始、08待05；不触碰05独立工作树。


- 2026-10-28：05在 `codex-canvas-types-05` 实现图片模型文本／图片独立采用、取消和顺序，预检显示真实有序图片，复用原有执行、当前输出、历史、固定文件另存与保护。已合入最新集成 `8c67ef51`；全部画布后端103 passed／27 skipped（MySQL未运行），Pylint10/10、Node24 typecheck、真实图片页面及1440px／390px截图验证通过。证据及受控供应商／外部存储限制见05票据；05待主区集成，08届时解除05阻塞，未自动开展其他票据。

- 2026-10-28：无冲突合并05（分支HEAD `a3e454ae`，合并提交 `2e1e93e9`），Completion 更新为 integrated，分诊Status保持不变。合并前05已包含主区 `8c67ef51`，集成后代码与其已验收实现一致；复用全部画布后端103 passed／27 skipped、Pylint10.00/10、真实图片页面及1440px／390px截图证据。主区Node24.22.1 typecheck、工作区／暂存区及合并差异检查通过。复核05隔离8277导出（去除测试控制路径）与当前 `front/openapi.json` 精确一致，没有schema或generated client变更；8000无响应，未停止、重载或从其生成，复用01标准更新及07独立导出验证，不声称本次标准openapi:update成功。受控供应商／外部存储和27项MySQL未运行限制保留。当前共六票集成，06进行中，08可开始；未触碰06工作树。


- 2026-10-28：06 在 `codex-canvas-types-06` 实现视频用途明确采用、统一binding分组与有序编译、定位诊断、固定视频用途历史、完整音轨及下游主体视频；代码 `d5b3827a`，无冲突合并最新集成 `07e7ab7e` 得 `418b759b` 后复验。全部画布后端110 passed／27 skipped、Pylint10.00/10、Node24 typecheck及图片／视频真实页面通过；旧07e7ab7e文本／图片实际成果跨版本读取保持依据有效，独立8279生产schema与OpenAPI精确一致。06 Completion为implemented待主区集成，分诊Status不变；详细红绿、截图与受控供应商／外部存储及MySQL限制见06票据。未提前实现08／09命名图片，不操作主区8000。

- 2026-10-28：无冲突合并06（分支HEAD `39800559`，合并提交 `63a028ac`），Completion 更新为 integrated，分诊Status保持不变。主区Node24.22.1 typecheck、视频及API HTTP回归61 passed／2 skipped与差异检查通过；已核实 `PYTHONPATH=. uv run --no-sync` 导入主区app。复用同一代码的全部画布110 passed／27 skipped、Pylint10.00/10、图片／视频真实页面及旧版文本／图片实际成果basis_current兼容证据。隔离8286生产OpenAPI与提交schema精确一致，无测试控制路径；重新gen仅365处纯尾空行并已剔除，证据 `/private/tmp/canvas06-integrated/openapi-8286.json`。8000隔离环境内探测无响应，提升权限复核健康检查已响应，但未核实其代码归属，未操作或从其生成schema，不声称标准openapi:update本次成功；MySQL及受控外部服务限制保留。当前共七票集成，08独立工作树进行中，09／10待08；未触碰08工作树。

- 后续主区复核：8000 已恢复响应，PID61721／73854 工作目录均为本工作区 backend；生产 OpenAPI 与集成 b64ce5e5 的 schema 精确一致（含 subject_name）。标准 openapi:update 已通过；生成器纯尾空行漂移已剔除，不引入无关文件变化。此前超时记录为当时事实，不再作为当前限制。

- 2026-10-28：无冲突合并08（分支HEAD `d8fa8a69`，合并提交 `71a007c8`），Completion 更新为 integrated，分诊Status保持不变。主区Node24.22.1 typecheck及08／视频／API HTTP回归 `74 passed, 2 skipped`（6.84s）通过；合并前分支已含主区 `60dba6df`，复用同一实现全部画布 `123 passed, 27 skipped`、Pylint `10.00/10`、08／06真实页面和共享工作台1440px／390px布局证据。已核实主区app导入路径，8000实际HTTP、主区生产导出与提交OpenAPI精确一致，含命名参考卡和稳定 `object_id` 选择器；标准 `openapi:update` 成功，371处纯尾空行漂移已剔除。工作区差异检查通过，backend／front／site与08验收分支精确一致；主区证据 `/private/tmp/canvas08-integrated`；MySQL及受控供应商／存储限制保留。当前共八票集成，09／10可开始；未推送、未修改其他工作树。


- 2026-10-28：10 在 `codex-canvas-types-10` 实现角色情境、人物表演与表演规则三类专用编辑及强类型完整设计输出；直接对象按身份／资格选择，示例文件／区间与模型输入分离，空与不适用／否定／开放提议／事实保留含义。HTTP 与真实 Worker／Chrome 证据、公开契约同步及验证限制见10票据；Completion 为 implemented 待主区集成，分诊 Status 保持不变。不接后续票据来源或摄影图片目标选择。

- 2026-10-28：无冲突合并10（分支 HEAD `7961350b`，显式合并提交 `f13e5ccd`），Completion 更新为 integrated，分诊 Status 保持不变。主区本票 HTTP／真实文本与视频 Worker `23 passed`（1.94s）、Node24.22.1 typecheck 通过；复用同一实现全画布 `141 passed, 27 skipped`、Pylint `10.00/10`、真实 Chrome 1440px／390px和共享工作台证据，受控供应商／存储与 MySQL 跳过限制保留。已核实主区 app 导入及8000父进程73854的主区 backend cwd，新导演 schema 与提交生产 OpenAPI 精确一致；标准 `openapi:update` 成功，379处纯尾空行漂移经与 HEAD 精确核对后剔除。当前共九票集成，09进行中，11／12／15可开始，18待09；未推送、未修改09工作树或接其他票据。
- 2026-10-28：09 在 `codex-canvas-types-09` 基于 `acdbf7be` 实施明确的另一角度参考动作与图／视频多参考名称映射；按所选对象类别创建新参考，直接复用 `object_id`，不复制图片或自动采用。视频映射使用实际用途和显式主体组内图片顺序，保留06绑定权威及旧图片映射序列化。全部画布后端126 passed／28 skipped、Pylint10.00/10、Node24 typecheck、真实多角度页面／Vidu请求顺序及共享工作台六项通过。隔离8283生产OpenAPI已同步generated client；09 Completion为implemented待集成，Status保持不变，详见09票据与 `/private/tmp/canvas09-page-ordered` 证据。MySQL与受控外部服务限制保留。

- 2026-10-28：接续合并09（分支 HEAD `228cab72`，显式合并提交 `d20271fb`）。README、共享契约、OpenAPI、浏览器注册及当前架构的冲突已保留双方：10三类完整导演设计、09 `NamedImageMapping` 用途／分组／用途内序号及空值兼容 serializer、实际视频媒体组内顺序均保留。09 Completion 更新为 integrated；01–10共十票完成集成，11／12／15／18可开始。主区设计／命名参考／视频 HTTP 与真实 Worker回归 `64 passed, 2 skipped`（7.32s）、合后标准生成后的Node24.22.1 typecheck、Pylint `10.00/10`（缓存stats权限提示，exit0）及差异检查通过。主区生产导出与8000实际HTTP schema精确一致，核对同时包含09映射字段与10设计契约后标准 `openapi:update` 成功，379处纯尾空行漂移已剔除。真实09／10页面与共享工作台验证复用各票相同实现证据；受控供应商／存储与MySQL跳过限制保留。未推送、未触碰其他工作树或开展后续票据。

- 2026-10-28：无冲突合入10服装参与资格修正（分支 HEAD `9be95e5a`，显式合并提交 `6fc0eac2`）。参与对象允许直接人物／服装／道具，后端资格与前端过滤一致；四项 HTTP 回归先红后绿，本票 `27 passed`，合入前已包含主区 `567b3e04`，合后代码与已验证分支一致。复用组合 HTTP／Worker `68 passed, 2 skipped`、Pylint `10.00/10` 和 Node24.22.1 typecheck；主区合并差异检查通过。09 映射三字段及 serializer 保留；无公开 schema 变化，无需重新生成 OpenAPI。01–10 仍共十票集成，其他票据进度不变；未推送、未操作11／12工作树。

- 2026-10-28：11在 `codex-canvas-types-11` 实现四类完整空间设计、稳定锚点／调度引用、直接关系与固定媒体标记保护；已合入集成 `c8e88301`，Completion为implemented待主区集成，分诊Status不变。全部画布173 passed／28 skipped（MySQL未运行）、Pylint10、Node24 typecheck、真实空间Chrome页面及工作台六例通过。首轮工作台环境失败与独立缓存复验记录、截图及外部服务限制见11票据；未自动开展14或操作主区8000。

- 2026-10-28：无冲突合并11（分支 HEAD `58f19865`，显式合并提交 `9cb75002`），Completion 更新为 integrated，分诊 Status 保持不变。分支已含主区 `c8e88301`；集成后空间／表演 HTTP 与真实文本／视频 Worker **47 passed**（4.14s）、Node24.22.1 typecheck 通过。复用同一实现全部画布 **173 passed／28 skipped**、Pylint **10.00/10**、真实空间页面及共享工作台六例证据；首轮白页／tooltip失败与隔离复测记录保留，不断言缓存根因。已核实 `PYTHONPATH=. uv run --no-sync` 导入主区 app，主区生产导出、已提交 OpenAPI 与8000实际HTTP schema精确一致且含 `SpatialReferencePayload`；标准 `openapi:update` 成功，390处纯尾空行漂移经精确核对后剔除。主区导出证据 `/private/tmp/canvas11-integrated-production.json`、HTTP证据 `/private/tmp/canvas11-integrated-http.json`；28项MySQL跳过及受控供应商／存储限制保留。01–11共十一票集成，12／15进行中，14／18可开始；未推送、未触碰其他工作树或接续其他票据。
- 2026-10-28：15在独立 `codex-canvas-types-15` 从 `c8e88301` 实现对白与声音安排强类型卡、稳定对白身份／版本、直接说话／声源对象、表演对白依据、固定音视频示例及完整设计编译。实现 `942abdd0`、共享字段尾空行修正 `8c5f6995`；本票HTTP25 passed、全部画布后端178 passed／28 skipped、Pylint10.00/10、Node24 typecheck及对白声音／既有表演真实页面通过。独立8291公开schema与提交OpenAPI精确一致（剔除测试控制路径）；公共工作台组件未改动，按实际影响范围复用10／11检查，详情、证据及MySQL／外部服务替身限制见15票据。Completion为implemented待主区集成，分诊Status不变；完成前最新集成仍为`c8e88301`，合并核对Already up to date。

- 2026-10-28：合并15（分支 HEAD `f5d07353`，显式合并提交 `101b99f9`）。共享契约、编译、关系校验、前端注册及生成类型冲突已保留11空间与15声音双方：`DesignTextPayload` 同时提供空间字段／关系／引用和声音字段／对白身份／版本／对白依据；空间与声音关系校验均执行，表演服装参与资格及09名称映射三字段继续保留。15 Completion 更新为 integrated，分诊 Status 不变；01–11及15共十二票集成，12／14进行中，18可开始。主区空间／声音／表演 HTTP及真实文本／视频Worker **72 passed**（6.47s），扩大至全部画布 **198 passed／28 skipped**（23.29s）；Pylint **10.00/10**（stats缓存写入受限，exit0）、Node24.22.1 typecheck及工作区／暂存区差异检查通过。已核实 `PYTHONPATH=. uv run --no-sync` 导入主区app及8000父进程73854的backend cwd；主区生产导出、8000实际HTTP与提交OpenAPI精确一致，核对双方设计契约及09映射字段后标准 `openapi:update` 成功，剔除纯尾空行漂移。证据 `/private/tmp/canvas15-integrated-production.json`、`/private/tmp/canvas15-integrated-http.json`。真实声音／受影响表演页面与1440px／390px截图复用15同一实现证据；空间编辑字段改为直接使用已验收的共享 `DesignFieldEditor`，控件行为不变，公共工作台按实际影响范围复用10／11检查。28项MySQL／可选环境跳过及受控供应商／存储限制保留，不证明真实供应商质量或生成声音。未推送、未操作12／14工作树或接续其他票据。

- 2026-10-29：18 在 `codex-canvas-types-18` 完成混合管道生命周期核对，新增真实图片→固定命名参考→表演→视频 HTTP／TaskWorker 与真实页面验证；修复撤回模型媒体仍被预检当作可用输出的问题，保留原位置及绑定并阻断未来输出承诺。后端200 passed／28 skipped、Pylint10、Node24 typecheck、mixed真实Chrome／桌面及窄屏截图通过；独立8295生产OpenAPI精确一致，generated无实质差异。18 Completion为implemented待主区集成，分诊Status不变；证据和边界见18票据，不操作其他票据或主区服务。
- 2026-10-28：12在独立分支 `codex-canvas-types-12` 完成摄影单卡五区、声明范围投影与图片画面目标，Completion 为 implemented 待集成，Status 保持不变。工作树已依次合入最新10服装修正、11空间与15对白声音集成事实。最终全部画布HTTP／真实Worker `215 passed, 28 skipped`，Pylint10.00/10、Node24 typecheck、摄影／表演／声音真实页面及规定工作台六项通过；生产8289 OpenAPI精确核对并同步generated client，09映射optional兼容保留。详情与限制见12 Comments；MySQL跳过及外部供应商／存储替身不扩大为生产验收。

- 2026-10-29：无冲突合并12（分支 HEAD `3ec454a0`，显式合并提交 `e8b55d61`），Completion 更新为 integrated，分诊 Status 保持不变。分支已包含主区 `1b353bf7`；主区摄影／空间／声音／表演 HTTP 与真实文本／图片／视频 Worker **89 passed**（7.97s），Node24.22.1 typecheck 通过。复用相同实现全部画布 **215 passed／28 skipped**、Pylint **10.00/10**、摄影／表演／声音三项真实页面及共享工作台六项证据；合并无冲突，产品代码与验收分支精确一致。已核实主区 app 导入路径、8000父进程73854的backend cwd；生产导出、8000实际HTTP与提交OpenAPI精确一致，含摄影、图片目标、空间、声音及09可选名称映射字段。标准 `openapi:update` 成功，406处纯尾空行漂移经精确核对后剔除；证据 `/private/tmp/canvas12-integrated-production.json`、`/private/tmp/canvas12-integrated-http.json`。28项MySQL／可选环境跳过及受控供应商／存储限制保留。01–12及15共十三票集成，13可开始，14／18进行中；未推送、未操作其他工作树或接续其他票据。

- 2026-10-29：14在独立 `codex-canvas-types-14` 实现叙事概览、节拍、事件与刺激、镜头设计，Completion为implemented待主区集成，Status保持不变。已合入11／15与12最终提交核对共享强类型字段；节拍／事件四种接收用途、镜头→摄影所属镜头、镜头可见结果→图片明确目标、覆盖节拍实际采用顺序上下移动均通过HTTP与真实页面验证。全画布232 passed／28 MySQL skipped，Pylint10.00/10、Node24 typecheck通过；文本／图片／视频真实Worker验证整卡且不穿透正文／媒体；独立8293／4293的Chrome桌面／窄屏、保存重开与组合交互通过。生产schema与generated同步，主区8000标准更新在集成后执行；复用未改共享控件的12六项工作台证据。具体路径、红绿记录与受控供应商／存储边界见14 Comments，不声称17验收来源或真实供应商视觉质量已验收。
- 18完成前已合入12集成 `e00192ac`，保留双方README实施记录，合后mixed／摄影scope真实HTTP与Worker **19 passed**、Node24 typecheck及mixed真实Chrome **8.1s**通过；独立8295最新生产OpenAPI精确一致。18仍为implemented等待主区集成，具体证据见18 Comments。

- 2026-10-29：主区依次集成14（`9678a1f0`）及18（`99659847`），仅README和浏览器套件列表冲突，保留双方新增记录及入口；Completion更新为integrated。合后叙事／混合／摄影／空间／声音／表演HTTP与真实Worker组合 **108 passed**（10.76s），Node24.22.1 typecheck通过，`git diff --check`通过；复用14全画布232 passed／28 MySQL skipped、Pylint10.00/10及两票真实页面证据。主区 `app.__file__` 已确认，当前生产app导出与提交OpenAPI精确一致（`/private/tmp/canvas14-18-integrated-production.json`）。8000父进程73854仍属当前主backend，但升级权限的urllib20／30秒与绕过代理curl10秒均无响应；未终止用户服务，标准 `openapi:update` 留待该服务恢复后复验，不从旧进程覆盖已同步契约。供应商／存储替身和MySQL缺环境边界保留。 当前01–12、14、15、18共十五票已集成，13／16／17可按依赖推进；未推送。

### 17 创作控制、生成指导与验收要求

- 已实现三类要求卡、默认完整设计输出、稳定验收引用及镜头／表演／摄影的明确验收关联。验收只读使用记录按实际绑定统计；关系只传身份名称，标准正文必须由模型直接采用。合法作用对象按字段资格选取，验收禁止反向绑定使用方；示例固定文件与区间不随设计输出传递。
- 独立验证：15项HTTP含三模态真实Worker，全画布249 passed／28 MySQL skipped，Pylint10、Node24typecheck；统一真实Chrome入口15.5s通过，覆盖真实拖拽候选、三使用方采用与取消、只读使用记录、完整标准直接采用、保存重开及390px窄屏。证据 `/private/tmp/canvas17-guidance-final`。implemented 等待主区集成；详情见17票 Comments。


- 2026-10-29：16在独立 `codex-canvas-types-16` 完成空间规则、连续性、不可改事实三类专用卡及强类型完整输出、直接关系、固定证据／前后态、图片目标。实现 `7a5fc1e0`，已合最新集成 `8e94c579`，Completion为implemented待集成，Status不变。本票HTTP17 passed，全部画布249 passed／28 MySQL skipped；Pylint10.00/10、Node24 typecheck及真实Chrome桌面／390px窄屏通过。合18后相关连续性／混合／摄影36 passed；HTTP生产schema与generated精确同步。实际拖线仍仅候选、证据不隐式传媒体、图片目标不截断整卡，图兼容仅补本票space_rule/fact稳定作用对象并与17协调。详情、红绿记录、证据目录和受控供应商／存储限制见16 Comments；共享组件未改，按影响复用12公共验收，主区标准OpenAPI更新待集成执行。

- 2026-10-29：13在 `codex-canvas-types-13` 实现独立风格整卡输出、图库／对比／大图和摄影五入口可视化预设，应用后成为本卡可编辑字段，示例与媒体输入／模型采用分离；原创 SVG／三秒 MP4 均标为几何示意。合入最新 `8e94c579` 后全画布239 passed／28 skipped、Pylint10、Node24 typecheck，真实预设与摄影页面分别11.7秒／11.4秒通过，生产schema与committed OpenAPI精确一致。Completion implemented待集成，Status不变；详细证据及边界见13票据。

- 2026-10-29：无冲突集成13（分支HEAD `eda252d1`，显式合并 `7a8c0b4f`），Completion更新为integrated，分诊Status不变。合后摄影／风格HTTP与真实Worker组合 **22 passed**（2.92s）、Node24.22.1 typecheck通过；复用同一实现全部画布239 passed／28 skipped、Pylint10及真实预设／摄影页面证据。主区生产app导出、8000实际HTTP与提交OpenAPI精确一致；8000本次已恢复，标准 `openapi:update` 成功，418处纯尾空行生成差异经精确核对后剔除。证据 `/private/tmp/canvas13-integrated-production.json`、`/private/tmp/canvas13-integrated-http.json`。此前14／18标准更新的环境阻塞为历史记录，本次最新主区契约已完成标准同步；MySQL和受控供应商／存储限制保留。01–15及18共十六票集成，16／17进行中，19待其完成；未推送、未操作其他工作树。

- 16交付前已同步13实现及最新主区 `b12275a1`；解决共享契约／导航／生成类型冲突后，连续性／风格／摄影39 passed、Pylint10、Node24 typecheck及真实Chrome完整页面再次通过。当前HTTP生产schema与提交精确一致；风格入口归“画面设计”，三类约束归“连续性与约束”。最后证据与合并边界见16 Comments，Completion仍为implemented待主区集成。

- 2026-10-29：无冲突集成16（分支HEAD `758cb145`，显式合并 `263fc51e`），Completion更新为integrated，分诊Status不变。合后连续性／风格／摄影／叙事HTTP与真实Worker组合 **56 passed**（6.66s）、Node24.22.1 typecheck及差异检查通过；复用同一产品实现全画布249 passed／28 skipped、Pylint10与真实Chrome证据。当前主区app导出、8000实际HTTP和提交OpenAPI精确一致，标准 `openapi:update` 成功，425处纯尾空行generated漂移经字节核对剔除；生产与HTTP证据在 `/private/tmp/canvas16-integrated-production.json`、`/private/tmp/canvas16-integrated-http.json`。保留限定空间规则／事实的结构引用兼容、风格和所有联合类型；不扩大其他接收卡资格。01–16及18共十七票集成，17进行中，19等待17；外部供应商／存储替身及MySQL未运行限制保持，未推送、未操作其他工作树。

- 17交付前已合主区最终 `fb1f95d2`，13风格与16连续性字段／编辑／预设／固定示例全部保留；合后全画布271 passed／28 skipped、Pylint10、Node24typecheck，真实Chrome要求卡统一入口15.7s再次通过，当前WT生产schema精确等提交OpenAPI。证据 `/private/tmp/canvas17-after16-guidance`；implemented待主区merger复验，未推送。

- 2026-10-29：无冲突合并17（分支 HEAD `3f84c01b`，显式合并提交 `d860ad66`），Completion 更新为 integrated，分诊 Status 不变；01–18共十八票集成，19解除阻塞。合后指导／连续性／叙事／摄影 HTTP 与真实 Worker **66 passed**（6.91s）、Node24.22.1 typecheck、差异检查通过；代码与实现分支一致，复用271 passed／28 MySQL skipped、Pylint10及真实Chrome要求卡证据。主区 app导入路径已确认，生产导出、8000实际HTTP、提交schema精确一致，含验收新契约；标准 `openapi:update` 成功，432处已证明仅尾空行的生成漂移及schema等价JSON格式差异已还原。证据 `/private/tmp/canvas17-integrated-production.json`、`/private/tmp/canvas17-integrated-http.json`，真实页面 `/private/tmp/canvas17-after16-guidance`。受控供应商／存储和MySQL缺环境限制保留；未推送。


- 2026-10-29：19在独立 `codex-canvas-types-19` 完成完整旅程与统一契约收口，合入主区最新 `4267b04c`，Completion为implemented待集成，Status不变。权威HTTP目录由真实卡类提供，前端generated Context消费，35物理类型／39入口、28逻辑端点、9输出、19规则及19接收矩阵逐项见[实现核对](implementation-coverage.md)。修复对白关系全文跨级、纯候选精确断边、通用素材字段定位及创作依据来源输出；补导演候选管理、四模态强类型、工作台Composer外观及可读来源。实际键盘red还定位并修复binding_id回填导致的光标前移及预检关闭后的稳定片段聚焦。
- 19验证：全部画布275 passed／28 skipped、诊断用词同步后相关42 passed／1 skipped、Pylint10、Node24 typecheck、生产／提交／真实8303HTTP schema精确一致。现行20页＋迁移5页＋新完整旅程共26个真实用例通过；selection隔离MySQL未配置，仅静态迁移，不宣称浏览器通过。完整旅程47.5s，证据 `/private/tmp/canvas19-journey-release/generation-canvas-journey`；其余执行、红灯修正、迁移和环境限制详见19 Comments。主8000标准更新留待集成后执行；未修改共享Details／Theme／Modal及既有场次职责，不开展章节、导演试点、音频生成或Take／剪辑改造。01–18仍十八票集成，19等待最终合并审查；未推送。

- 2026-10-29：无冲突集成19（分支HEAD `1a2b350d`，显式合并 `4da2f90e`），Completion更新为integrated，分诊Status保持不变。01–19共十九票已集成，待最终规范／规格双轴审查。合后API／Catalog／Compiler **42 passed／1 skipped**（3.63s）、Node24.22.1 typecheck及差异检查通过；无冲突产品树与实现分支一致，复用275 passed／28 skipped、Pylint10及26个真实页面通过的同代码证据，selection缺隔离MySQL仍明确未执行。已核实主区app导入路径；当前生产app导出、8000实际HTTP与提交OpenAPI精确一致，包含Catalog、BasisText、DialogueReference及四模态枚举。标准 `pnpm --dir front run openapi:update` 成功，440处仅纯尾空行／等价格式漂移经字节或JSON精确核对还原；证据 `/private/tmp/canvas19-integrated-production.json`、`/private/tmp/canvas19-integrated-http.json`。供应商／外部存储受控替身、MySQL缺环境与未证明真实供应商质量的边界保留。未推送、未终止用户8000服务；最终双轴审查尚待主代理执行。

- 2026-10-29：最终双轴审查以 `66f32c19` → `0d9d5c4d` 为固定范围。Spec发现一个P2：描述进入模型时仅匿名正文，两个描述与独立命名图片缺少对应；已在独立审查修复分支先用HTTP→实际图片TaskWorker复现，再使每份直接采用的描述正文前带自身名称、稳定身份与类别，原正文不变，不反查参考卡或自动采用图片。两个对象及反向描述顺序的请求均红→绿；描述单独采用、未命名正文与纯文本保持原行为。可选重复格式化建议以一个 `scope_source_lines` 小函数收敛五个publisher，标签、顺序及空值行为不变。全画布 **277 passed／28 skipped**（30.98s），Pylint **10.00/10**，生产OpenAPI与提交schema精确一致；无前端或schema字段变化，复用26真实页面／Node24typecheck证据，不重复同状态UI。MySQL／外部服务替身限制不变。
- Standards另有两个早期自动merge标题不符合 `[类型] 摘要`：`c92bc274`、`6639d43a`。安全脚本 `/private/tmp/canvas-card-types-normalize-merge-subjects.py` 已在主区只读dry-run，并在独立临时克隆中验证apply：只改这两个标题，保留树、父拓扑、作者／提交者／日期及其他消息；109个必要后继重算ID，源树哈希不变。原主区HEAD未改；元数据规范化须在本修复合入后由merger执行，不能预记已完成。审计 `/private/tmp/canvas-card-types-merge-subject-normalization-dry-run.json`、`/private/tmp/canvas-card-types-normalization-isolated-apply.json`；后续实际主区apply审计另记。

- 2026-10-29：无冲突集成最终审查修复 `95ebbe70`（合并提交 `199b3448`）。合后对象描述／命名参考／Compiler公开HTTP与实际Worker回归 **28 passed**（2.52s），差异检查通过；合并产品树与修复分支精确相同，复用该分支全画布 **277 passed／28 skipped**、Pylint **10.00/10**。前端及公开schema字段未改，复用已通过的26页、Node24 typecheck和19标准OpenAPI同步，不重复相同契约生成。描述自身身份标注与五publisher格式化均保留；MySQL／受控供应商及存储边界不变。元数据脚本已检查干净集成分支、固定基线、签名拒绝、完整原始headers／父拓扑、隐藏备份ref、旧新tree相同及CAS守卫，实际apply结果记录 `/private/tmp/canvas-card-types-merge-subject-normalization.json`；后续以该审计的 `applied` 及两轴复核为准。尚不预记最终审查通过；未推送、未终止用户服务。


- 2026-10-29 最终收口：规范轴与规格轴定向复核均完成，剩余发现均为 **0**。规格代理独立执行描述归属最小公开 HTTP→真实 TaskWorker 回归 **4 passed／5 deselected**；规范代理独立核对五处格式化调用及范围内117个提交标题，并复核112对重算提交的原始headers、消息正文、tree与父拓扑。复核HEAD为 `31da35347ae46d3a3bd9ef3e108aa7b79ac6ed8c`；审查报告 `/private/tmp/canvas-card-types-standards-review.md`、`/private/tmp/canvas-card-types-spec-review.md`。最终实现验证为全画布 **277 passed／28 skipped**、Pylint **10.00/10**、Node24 typecheck、26个真实页面用例、标准OpenAPI同步及生产／提交／实际HTTP契约一致；未配置隔离MySQL的selection页面明确未执行，外部供应商与存储使用受控替身，不宣称真实供应商质量或MySQL竞争通过。01–19均为integrated，分诊Status保持原含义。
- 提交元数据收尾已实际apply：仅修正两个早期自动merge标题及其必要后继，原新HEAD的tree均为 `f47833340b350528f73039a127ddfd7b22c58660`。备份ref与完整映射保存在 `/private/tmp/canvas-card-types-merge-subject-normalization.json`；旧阶段提交引用仍可通过保留的备份／票据分支读取。后续文档收尾不改变产品代码。
- 临时工作树清理前，旧记录中的 `front/test-results/browser-*` 证据已复制到 `/private/tmp/jellyfish-canvas-types-preserved-evidence/`，原路径到归档路径见其 `manifest.json`；其他票据使用的 `/private/tmp/canvas*` 和系统临时目录证据继续保留。共享backend editable安装已恢复主工作区并从工作区外导入验证，清理不依赖临时工作树。

- 清理完成：本次21个实现／辅助／审查修复工作树及标题脚本隔离克隆已删除，原票据分支与元数据备份保留；工作树清理审计 `/private/tmp/canvas-worktree-cleanup.json`。当前仅保留用户原主工作区，验收证据归档及独立临时目录未删除。

- 2026-10-29 布局增补实施：20已无冲突集成（实现 `b613ae71`）。真实生成页面6.1s与成对导演基准5.3s证据见20 Comments，主区Node24 typecheck／差异检查通过，01–19字节不变。21、22、23、25解除依赖；本票不代表其他区域最终视觉验收完成，外部服务仍使用受控替身。
