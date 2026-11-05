# 生成画布：统一来源引用与验收采用

Status: ready-for-agent
Blocked by: None
Date: 2026-11-05

## Problem Statement

生成画布中，用户已通过连线提供候选，并能在设计字段中引用完整来源，但多种设计卡还提供独立的“作用对象”选择。用户难以判断连线、字段引用和对象选择是否重复，是否需要反复选择，以及哪一种操作实际影响生成输入。折叠区缺少明确内容或状态时，又容易被误认为未加载或未完成的功能。

验收要求卡存在参考来源输入、向设计附着标准、向模型提供标准三种方向不同的关系。它们分别表达参考、随设计采用和直接采用，却容易被误解为对描述卡或设计卡执行验收。实际上，当前功能只定义并传递标准与期望，不复核生成结果。

同一来源可能同时承担通用作用对象、明确业务角色、字段引用和素材用途。直接删除来源线或所有绑定，会误伤主体、说话对象、焦点、顺序和定位；只隐藏控件则会留下不可见但仍影响生成的依赖。候选区当前主要按字段引用统计使用状态，不能完整反映关系采用，也加重了上述混淆。

本规格统一通用来源表达，同时保留明确业务语义，并明确旧数据清理、多路径依赖、历史运行和撤销恢复的边界。

## Solution

移除指定 18 类设计卡的通用“作用对象”界面、专用绑定及输入用途。一般涉及对象通过原有字段的纯文本或完整来源引用表达，不新增另一套对象采用列表。完整引用不等于采用来源卡的全部媒体或历史结果。

保留主体、说话对象、关注对象、焦点对象、所属空间、叙事关系、锚点、节拍顺序及画面定位等明确用途。候选界面同时说明字段引用和关系采用，不再让用户看到“已用于业务关系却仍只是候选”的矛盾状态。

验收要求可直接被模型采用，也可附着于受支持的设计卡，在模型实际采用设计时一起进入生成。多路径按稳定来源输出身份去重，解除一种用途只撤回该路径的贡献。标准是否已采用，与结果是否通过验收始终分开表达。

旧通用绑定直接清理，不自动改写正文或推断其他用途。保留合法候选连接、其他有效用途和历史运行依据；清理不得被旧撤销记录或保存重开逆转。

## User Stories

1. As a canvas creator, I want generic object references to use the existing field editor, so that I do not have to adopt the same source through a second object list.
2. As a canvas creator, I want to write requirements in plain text without connecting an object card, so that simple instructions remain easy to express.
3. As a canvas creator, I want names in plain text to remain ordinary text, so that the application does not silently bind a similarly named card.
4. As a canvas creator, I want explicit references to retain stable source identities, so that renaming a source does not change which content I mean.
5. As a canvas creator, I want a description or design reference to adopt its complete content, so that references do not silently select arbitrary source fields.
6. As a canvas creator, I want to select a specific media item or model output, so that referencing one item does not adopt every result or historical asset on its card.
7. As a canvas creator, I want explicitly referenced dependencies to accompany an adopted design, so that the model receives the context that the design actually uses.
8. As a canvas creator, I want unselected candidates and local examples to remain outside generation inputs, so that browsing does not change the model request.
9. As a requirement author, I want material connected to a requirement card to become a candidate, so that I can decide whether to reference it in the standard.
10. As a requirement author, I want requirements to be prohibited from targeting material or description cards, so that those inputs are not mistaken for objects undergoing acceptance review.
11. As a requirement author, I want a requirement connected directly to a model to be adopted, so that its effect does not depend on where I place its text in the prompt.
12. As a requirement author, I want a requirement attached to a design to follow that design when adopted, so that I do not need to reconnect the requirement for every model using that design.
13. As a requirement author, I want requirements attached to unused designs to remain inactive for a run, so that mere graph reachability does not expand model inputs.
14. As a requirement author, I want requirements to express expectations without reporting a pass or failure, so that a connection cannot be mistaken for a completed result review.
15. As a requirement author, I want model results connected into a requirement card to remain reference material, so that this connection does not imply submission for review.
16. As a requirement author, I want cyclic dependencies and requirement-to-requirement connections to be rejected, so that standards have an understandable direction of dependency.
17. As a canvas creator, I want a requirement arriving through several adopted designs and a direct connection to be imported once, so that repeated paths do not duplicate instructions.
18. As a canvas creator, I want shared source dependencies in a diamond-shaped graph to be imported once, so that common context is not duplicated.
19. As a canvas creator, I want different sources with identical text to remain distinct, so that content equality does not erase their separate identities.
20. As a canvas creator, I want repeated references within my own prose to remain in place, so that dependency deduplication does not rewrite my expression.
21. As a canvas creator, I want the application to retain the reasons a source is adopted, so that I can understand why it remains active after removing one path.
22. As a canvas creator, I want removing one adoption path to preserve all remaining paths, so that unrelated uses continue to work.
23. As a canvas creator, I want a source to leave the model input only when its final effective adoption path disappears, so that removing a design does not override a separate direct adoption.
24. As a performance designer, I want to retain the explicit performer while removing generic object selection, so that visual generation still knows whose situation or performance is being described.
25. As a dialogue author, I want the explicit speaker to remain distinct from ordinary text references, so that dialogue identity and speaker constraints remain intact.
26. As a visual designer, I want attention and focus roles to remain separate, so that selecting what attracts attention does not automatically select what is in focus.
27. As a spatial designer, I want space membership, anchors and image markers to remain intact, so that simplifying generic references does not remove spatial meaning.
28. As a narrative designer, I want beat order and event relationships to remain intact, so that source cleanup does not change narrative structure.
29. As a composition designer, I want movement-frame positioning to remain intact, so that a generic reference change does not alter the chosen visual state.
30. As a sound designer, I want to describe or reference a sound source in the relevant sound field, so that I do not need a second generic source-object selection.
31. As a canvas creator, I want each candidate to show all of its actual uses, so that relationship adoption and field-reference adoption are both visible.
32. As a canvas creator, I want empty, loading and failed candidate states to be distinguishable, so that an empty panel does not look like a broken feature.
33. As a canvas creator reopening old data, I want obsolete object bindings removed without rewriting my prose, so that cleanup does not invent new intent.
34. As a canvas creator reopening old data, I want other uses of the same source preserved, so that cleanup cannot remove a performer, focus target or field reference.
35. As a canvas creator reopening old data, I want a still-compatible source connection retained as an unused candidate, so that cleanup preserves my available material without adopting it.
36. As a canvas creator reopening old data, I want connections with no legal remaining purpose removed, so that obsolete endpoints do not remain in the graph.
37. As a canvas creator, I want missing explicit references retained with useful diagnostics, so that I can repair them without losing their intended identities.
38. As a canvas creator, I want to save an incomplete draft while only affected generation is blocked, so that unrelated candidates or unused designs do not prevent work.
39. As a canvas creator, I want protected references to prevent accidental source deletion or disconnection, so that these actions do not silently damage my content.
40. As a canvas creator, I want batch deletion to consider references outside the deletion set, so that internal references between cards being deleted do not require needless manual cleanup.
41. As a canvas creator, I want deleting a requirement to remove its associations without deleting the material it referenced, so that independent source cards remain available.
42. As a canvas creator, I want undo and redo to restore each ordinary edit atomically, so that cards, connections and bindings remain consistent.
43. As a canvas creator, I want old undo states and reopening to be unable to restore retired bindings, so that obsolete behavior does not reappear.
44. As a user inspecting past runs, I want completed inputs, outputs and history preserved, so that historical evidence remains trustworthy.
45. As a user submitting or retrying generation, I want an incompatible old execution snapshot to require a new submission, so that the application does not silently execute changed inputs under the old run record.
46. As a user with a model request already in progress, I want it to finish using its original inputs, so that document cleanup does not alter or cancel an issued request.
47. As a canvas creator, I want explicitly referenced media checked against model capabilities, so that unsupported inputs are reported rather than silently omitted.
48. As a read-only viewer, I want to inspect adoption roles and source diagnostics without editing them, so that understanding the graph does not require write access.

## Implementation Decisions

### 1. Scope: retire generic object adoption on exactly 18 card types

| 卡片 | 类型标识 | 移除 | 保留／替代表达 |
| --- | --- | --- | --- |
| 验收要求 | `direction.criterion` | 通用作用对象 | 标准正文、完整引用、验收身份与采用关系 |
| 创作控制 | `direction.creative_control` | 通用作用对象 | 原有要求字段与完整引用 |
| 生成指导 | `direction.guidance` | 通用作用对象 | 原有指导字段与完整引用 |
| 不可改事实 | `direction.fact` | 通用作用对象 | 事实、来源依据与完整引用 |
| 表演规则 | `direction.performance_rule` | 通用作用对象 | 表演适用说明与完整引用 |
| 角色情境 | `direction.situation` | 通用作用对象 | 参与对象、处境和关系字段 |
| 人物表演 | `direction.performance` | 通用作用对象 | 参与对象、节拍、接收事件、对白依据、验收关联及表演字段 |
| 镜内活动 | `direction.activity` | 通用作用对象 | 参与对象、区域锚点、触发事件及活动字段 |
| 叙事概览 | `direction.narrative` | 通用作用对象 | 叙事字段与完整引用 |
| 事件与刺激 | `direction.event` | 通用作用对象 | 事件身份、动作说明与完整引用；不改变下游事件用途 |
| 空间规则 | `direction.space_rule` | 通用作用对象 | 所属空间、规则字段与完整引用 |
| 空间锚点 | `direction.anchor` | 通用作用对象 | 所属空间、锚点身份、图片标记、位置及空间关系 |
| 机位与视角 | `direction.camera` | 通用作用对象 | 所属镜头、验收关联与具体设计字段 |
| 光影与色彩 | `direction.lighting` | 通用作用对象 | 所属镜头、验收关联与具体设计字段 |
| 景别与构图 | `direction.composition` | 通用作用对象 | 所属镜头、验收关联、运镜画面定位与具体设计字段 |
| 运镜 | `direction.movement` | 通用作用对象 | 关注对象、所属镜头、验收关联、阶段及具体设计字段 |
| 焦点与成像 | `direction.focus` | 通用作用对象 | 关注对象、焦点对象、所属镜头、验收关联与具体设计字段 |
| 声音安排 | `direction.sound` | 使用通用作用对象绑定的“声源对象” | 声源说明、环境声、动作声、音乐约束、制作安排及本地参考 |

- 移除以上类型的 `effect_object` 输入用途、可编辑绑定和对应控件，不仅隐藏 UI。前后端目录、连线判断、保存校验、输出及依赖解析必须一致。
- 其他七类设计卡（画面风格、站位与走位、环境活动与留白、对白、叙事节拍、镜头设计、连续性设计）不因本次清理新增或移除业务关系；共享候选状态改进可适用于它们。
- 保留明确主体／参与对象、说话对象、关注对象、焦点对象、所属空间、叙事用途、锚点、覆盖节拍顺序、画面定位及其现有类别、数量、顺序和保护规则。一般字段引用不自动填写这些角色。
- 不以关系最终进入提示词为由判定其冗余。明确角色、顺序及定位本身就是需要保留的语义；现有视觉生成主体要求继续生效。

### 2. Requirement direction and adoption

设 A 为素材／描述来源，B 为验收要求，C 为设计，D 为模型。

| 关系 | 目标行为 |
| --- | --- |
| A → B | 提供标准字段候选；字段明确引用后才采用 |
| B → A | 不允许；描述／素材卡不接收验收标准 |
| A → D，同时 B → D | D 分别按自身契约采用 A 和 B；B 可以纯文本提及 A，不要求 A → B |
| B → D | 连线直接采用完整标准，与标准在正文中的位置无关 |
| B → C，C 被 D 实际采用 | 随 C 带入 B，无需额外持久模型绑定或画布连线 |
| B → C，C 被 D 实际采用，同时 B → D | B 有两条采用路径，完整标准只导入一次 |

- 验收附着维持现有七类接收设计：人物表演、镜头设计、机位与视角、光影与色彩、焦点与成像、景别与构图、运镜。不给其他设计类型新增验收端口。
- B → C 是随设计采用标准的便利关系，不是对设计卡执行检查，也不等于标准对所有可达下游自动生效。只遍历实际采用和有效明确依赖，不遍历未采用候选。
- 创作控制、生成指导、不可改事实、表演规则不因此新增类似验收附着的关系。
- 验收卡之间不允许相互引用或建立验收关联。B → C 与 C → B 形成循环时在连接前拒绝；不得通过隐藏依赖、反转连线或自动补线绕过。可以选择 B 引用 C，并将二者分别接入 D，但不能同时保留反向附着。
- 模型结果接入验收卡仅作为编写标准的参考，不能表达提交验收。当前只定义并传递标准与期望，不输出结果通过／不通过结论。
- 已确认的验收只读缩略展示、与素材候选分区、默认收起、浏览选择及源卡定位规则保持。名称为空时连接前提示、输入框内 placeholder 等现有名称交互保持；不新增标准正文必填条件。

### 3. Whole-source references and media

- 一般对象关系使用现有字段编辑器；不新增“已选对象”列表或第二次采用步骤。普通文字保持原样，名称匹配、仅有一个候选、连接或预览都不自动建立引用。
- 描述／设计引用指向完整来源内容，不能仅采用来源卡的某个字段。来源有明确依赖时继续按现有完整依赖规则携带，不能机械将旧对象身份出口换成正文引用。
- 媒体和多项模型输出按实际使用的稳定输出标识选择具体项；“整卡引用”不扩展为采用所有媒体、历史结果或候选。描述、对象身份与图片出口具有不同含义，不能仅按来源卡 ID 丢弃其差异。
- 验收标准沿用文本、完整设计、图片和视频引用能力，不新增音频字段引用。明确引用的媒体随标准进入依赖，并遵守接收模型的素材用途与能力校验；不支持时诊断，不静默省略。
- 未引用候选、独立正反例、本地素材示例不自动携带。对白等已有的专属字段／媒体限制不因共享 UI 调整放宽。
- 专用画面定位与“只引用来源字段内容”不同：已有定位配置保持，同时保留完整设计采用规则。

### 4. Dependency identity, multiple paths and release

- 在一次模型编译范围内，按稳定来源输出身份去重完整标准与共同依赖，不按显示名称、正文或文件内容去重。复用现有输出标识语义，不创建第二套身份体系。
- 多个设计共享 B、D 直接采用 B，以及菱形依赖共享 A，均不得重复导入相同完整输出。不同来源或不同用途的媒体不得因同卡／同文件被错误丢弃。
- 保留实际采用路径以解释输入来源；不额外持久化一份可能过期的最终依赖列表，也不新增永久模型绑定或画布连线。
- 正文中主动重复引用同一来源时保留各处表达；去重不重写用户的语句。
- 同时存在 B → C → D 与 B → D：解除 B → C 或停止采用 C，只撤回经 C 的贡献；解除 B → D 时，随 C 的贡献仍存在。最后一条有效路径消失后，B 才退出生成输入。B 的依赖 A 也遵循这一规则。
- 卡内解除一种用途仅清除该用途。断开整条来源线前检查其承载的所有用途；存在受保护的正文或业务关系时拒绝并定位，先解除引用再断线。纯候选线允许直接断开；现有允许随断线解除的独立采用不新增保护限制。

### 5. Candidate presentation

- 候选展示同时汇总字段引用与关系采用，明确显示诸如“已用作说话对象”“已引用于动作说明”的实际用途；同源多用途分别表达。
- 不把关系采用误显示为纯候选，不把暂不生效字段引用误显示为已参与生成，不把预览或本地示例计为模型采用。
- 同一来源与接收端仍只展示一条来源线，线的用途信息反映所有保留用途；纯候选明确处于未采用状态。候选中的不同输出项仍保持各自身份。
- 无来源、加载中和读取失败分别提示，避免无说明的空白。继续使用现有组件和只读权限边界；浏览不保存或增加撤销记录。

### 6. Current-document cleanup

- 当前画布直接清理 18 类卡片的废弃通用绑定，不保留旧用途兼容层。不自动插入引用、追加对象文字，或转换为主体、关注、焦点等角色。
- 只按已废弃用途清理，不能按来源卡删除全部绑定。同一来源的主体、正文引用、素材用途、顺序和定位保留其原有身份与内容。
- 同一来源与接收卡有其他合法用途或引用时保留来源线及这些用途。没有已采用用途但仍能作为合法字段来源时，保留为当前契约下的纯候选，不继续保留废弃端点；没有合法用途时移除连接。
- 来源线的规范化不得新增实际采用或重复连线，也不得破坏现有有效字段引用所需的连接。保留候选不等于把旧作用对象绑定迁移为引用。
- 旧绑定单独贡献的依赖停止进入生成；由其他有效用途采用的来源继续进入并去重。通用绑定与主体恰好指向同一来源时，只删除前者。
- 保留名称、普通正文、有效字段引用及其状态、用途、来源元信息；不顺带清理其他失效引用、旧媒体或业务关系。本次清理自身不得注入手填／预设默认元信息。
- 在当前画布读取、保存及旧编辑状态恢复等既有入口保持一致规范化，遵守现有保存修订与并发保护；重复读取或保存不能反复改写已清理数据。

### 7. Missing sources and deletion

- 显式来源失效时保留引用和身份，明确标记原因及位置，允许保存草稿，不自动删除或退化为普通文字。
- 只有实际采用并参与本次生成的有效字段引用失效时，才阻止受影响的编译／生成；未采用候选和未采用设计不阻塞。暂不生效字段中的引用不导入依赖，但仍受删除保护。
- 正文仍引用 A 时，删除 A 或断开唯一必要来源连接受保护。B 被 D 正文显式引用时，同样先解除引用。
- B 仅通过验收关联被采用时允许删除，明确展示受影响接收端，在同一编辑操作中删除关联和连接。B 曾引用的 A 不随之删除，其他接收端对 A 的采用不变。
- 批量删除来源及其消费者时，仅检查删除集合外的保留引用；不要求先手工拆除一并删除的内部引用。

### 8. Historical runs, undo and reopen

- 已完成运行的固定输入、结果集和历史记录不改写；历史中的旧结构仍是当时的事实，不清理成当前方案。
- 未执行、等待执行或请求重试的运行，若固定快照包含本次废弃绑定，必须明确提示基于当前画布重新提交，并禁止按清理后的输入继续旧运行。只影响实际冲突快照，无冲突运行保持原行为。
- 已经发起模型请求的运行按原固定依据继续，不因当前画布清理修改输入或取消请求。使用既有任务与运行状态判断边界，不建设新的调度／恢复体系。
- 普通断线、解除采用、删除等操作保持原子撤销／重做，卡片、连接和绑定一起恢复或移除，再由现存路径计算有效依赖。
- 数据规则清理不进入普通编辑撤销记录；旧撤销／重做快照和保存重开都不能恢复已退役的用途。规范化时保留其他有效用途和引用，不为了防恢复而任意丢弃无关编辑。
- 不新增跨重开的撤销能力，不改变正常历史记录的原有保留边界。

### 9. Module and contract responsibilities

- 变更涉及卡片类型目录与输入用途契约、文档清理与保存校验、来源解析与依赖编译、历史快照执行准入、画布连接／删除／撤销操作，以及设计编辑器和共享候选展示。
- 后端负责最终合法性、清理和执行判断；前端按同一目录提供连接前提示和准确展示。前端 API 调用继续使用生成客户端，业务逻辑保留在服务层。
- 公共目录、schema 或接口语义变化时同步后端契约、OpenAPI 与前端生成客户端；生成前验证本机后端确实加载当前工作区改动。内部局部状态变化不机械触发接口再生成。
- 实现后更新被改变的架构事实和操作说明，包括已过时的“身份不递归传播”描述；发布本规格时不提前把未实现方案写成当前架构事实。不新增无关路线图或发布说明。

## Testing Decisions

测试边界复用本会话已获用户同意的两类最高层现有接口：公开保存／读取／编译／运行 API，以及使用真实后端的画布浏览器操作。本规格不新增测试接口，不重复询问已确认的边界。

好的测试从用户输入和可观察结果出发：验证保存重开后的文档语义、编译输入与来源、任务是否调用供应商、可见候选用途、删除保护及撤销结果；不只断言组件内部状态、私有函数调用次数或实现所用的数据结构。供应商边界可以沿用现有替身，以验证真实任务编排而不产生付费生成。

### Public API and execution coverage

| 场景 | 外部可观察的验收结果 |
| --- | --- |
| 18 类卡片逐类读写旧通用绑定 | 废弃用途被清理；普通正文、有效关系、顺序、定位及元信息保持 |
| 同一 A 同时是旧作用对象、主体和字段来源 | 仅旧作用对象消失，其他用途与必要连接完整保留 |
| 仅有旧用途但仍有合法来源输出 | 保留纯候选，不创建引用、实际采用或隐式角色 |
| 无合法用途的旧连接 | 清除连接及其相关排序残留，不影响其他来源线 |
| 重复读取／保存已清理文档 | 数据稳定，不重复变更；遵守既有修订冲突行为 |
| 纯文本标准、完整描述／设计引用 | 纯文本不产生绑定；显式引用使用完整来源与明确依赖 |
| 单个媒体／模型输出引用 | 只使用指定项，不扩大为所有输出或历史结果 |
| 直接 B → D 与随设计采用 B | 两种有效路径提供相同完整标准；未采用 C 不带入 B |
| 多设计共享 B、直接加间接 B、菱形依赖共享 A | 相同输出只导入一次，保留实际来源用途；不同身份相同正文不合并 |
| 逐条移除采用路径 | 仅最后有效路径移除后标准／依赖退出；正文重复表达保持 |
| 图片／视频引用及不支持能力 | 正确携带并检查用途；能力不支持、必要素材缺失时准确阻止 |
| 候选失效、有效引用失效、暂不生效字段引用 | 候选不阻塞；有效依赖阻止相关运行；非生效引用保持删除保护 |
| 明确主体及其他保留业务角色 | 原有类别、数量、顺序和视觉生成主体校验不回退 |
| 历史快照冲突及无冲突对照 | 冲突未发起请求的任务不调用供应商并要求重新提交；无冲突任务正常 |
| 已发起模型请求及已完成运行 | 原固定输入与历史成果保持，不因清理取消或改写 |
| 非法方向及循环 | B → 素材／描述、验收互引和循环均明确拒绝 |

优先扩展已有验收关联公开接口测试、完整设计字段引用与素材能力测试、实际任务工作器测试，以及现有“多设计加直接验收去重”“菱形完整设计依赖”“旧验收冲突清理”的回归场景。当前默认编译路径是完整设计依赖闭包，应测试真实正常路径，不能只验证较窄的验收补充逻辑。

### Browser coverage

- 在既有创作要求、表演、空间、叙事、声音约束、画面设计和关系交互浏览器用例上扩展，不建立第二套画布测试框架。
- 覆盖 18 类卡片移除入口、保留的明确角色可操作、字段完整引用、纯文本编辑及名称标签／placeholder 不回退。
- 验证同源多用途只展示一条来源线；候选区正确展示所有采用角色，预览不采用，单用途解除不影响其他用途。
- 验证无来源、加载、读取失败、已引用但未生效和失效来源的可见状态；只读可查看但不能改变采用。
- 覆盖连接前错误提示、整条线断开保护、源卡删除、批量删除、撤销、重做和保存重开。
- 使用含废弃绑定及有效其他用途的旧文档和旧编辑快照，验证清理不会被撤销／重做恢复，也不误伤其他用途。
- 检查原有验收缩略区与素材候选分离、默认收起及浏览只读交互保持；覆盖窄屏布局和键盘操作。

### Required checks during implementation

- 前端代码、类型或构建配置变化后运行前端 typecheck，并按影响运行相关单元与浏览器测试。
- 后端代码变化后运行相关公开接口及任务测试，并运行应用 Pylint。共享依赖、清理或执行准入影响范围广时扩展回归范围。
- 对外契约变化时完成 OpenAPI 与生成客户端同步；文档检查不得代替运行时验证。
- 相同代码与环境下的已通过验证复用；新增修改、失败或未解决疑点才要求重跑。未能执行的必要检查单独说明。
- 本次仅发布规格，以上是实现验收要求，不宣称这些新行为已经通过测试。

## Out of Scope

- 自动复核生成结果、通过／不通过结论、素材审查、剪辑采用或整场验收。
- 将验收关系推广到描述／素材卡、所有设计卡，或给其他要求卡新增随设计附着机制。
- 删除或重设计参与对象、说话对象、关注／焦点对象、所属空间、叙事关系、锚点、覆盖节拍顺序或画面定位。
- 新增来源字段级采用、按名称自动绑定、从纯文本推断主体，或自动改写旧正文以完成迁移。
- 采用整张来源卡的全部媒体、全部历史结果或未采用候选；新增音频字段引用能力。
- 改写已完成历史、原地修改运行固定依据、新建任务调度／恢复体系或跨重开撤销能力。
- 无关失效数据清理、无关界面重构、名称字段再设计、元信息编辑能力或默认信息恢复。
- 在本次规格发布时开始实现、拆分实现票据、提交代码、部署或创建新的路线图／发布说明。

## Further Notes

- 本规格来自本次会话已经确认的 Q1–Q23，以及用户随后要求整理的最终完整方案；不是新的待访谈草案。
- 现状已经具备完整依赖遍历、多路径验收去重和来源保护，优先复用这些能力；需改变的是通用用途、清理范围及展示一致性，不重建图与编译系统。
- 单一来源线是用户界面的展示单位，来源输出身份是依赖去重单位，连接用途是采用角色；三者不能混为同一个身份。
- 本规格沿用项目的“生成画布”“画布文档”“画布运行”“生成结果集”“连接用途”“输出标识”等术语，并延续文档与运行依据分离、候选与实际采用分离的协议边界。
- 发布方式为项目本地 Markdown 任务系统；`ready-for-agent` 表示规格可以进入实现，不表示功能已经实现或已获部署授权。
