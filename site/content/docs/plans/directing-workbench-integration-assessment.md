---
title: "六部门导演流程与工作台融合评估"
description: "评估以场次导演方案驱动分镜、生成、审片与局部返工的工作台改造。"
weight: 36
status: superseded
---

> 2026-09-14 评估提案，尚未实施或批准。以本次查阅的本地代码和参考仓库 main 为依据。项目处于开发阶段，目标方案不保留旧流程、旧 API、双写或历史兼容分支；本文不代表允许删除现有开发数据。

> 本文是已被取代的早期评估，以下内容保留当时的分析依据，不再作为当前目标。用户已解除旧流程约束，后续以[场次创作与试拍剪辑工作台方案](/docs/plans/directing-workbench-refactor-plan/)为准；旧页面边界、单镜生成限制和末端剪辑顺序均已重新评估。

## 1. 结论与评估范围

建议采用 Leos 六部门导演流程的创作顺序，将工作台主线调整为：

```text
章节原文 → 场次划分与事实准备 → 场次导演方案
→ 分镜设计与确认 → 生成准备与提示词审稿
→ 视频试拍 → 审片与选择可用区间 → 场次粗剪
                                ↑          ↓
                                └─ 定点补拍 ┘
```

关键变化是增加共享的场次设计和结果验收。仅替换视频模板、增加六个角色按钮，都无法建立这个闭环。

假设“工作台”包括 ProjectWorkbench、分镜准备页、ChapterStudio 和后期剪辑入口；本次工作是评估和提出方案，不改动产品实现。成功标准是明确现有缺口、目标页面职责、数据真值、执行边界和可验收的实施顺序。

六部门工作法更适合多镜头叙事，但流程本身不能证明生成质量提升。短素材可以使用简版设计，仍保存必要事实与设计版本；复杂对话、动作、多人场面才展开完整工作单。最终应通过相同素材、模型和预算的对照试验验证收益。

## 2. 当前实现与差距

| 方面 | 本地代码事实 | 融合所需变化 |
| --- | --- | --- |
| 组织结构 | Project → Chapter → Shot；Shot 直接保存 chapter_id | 引入章节内有顺序的叙事场次 Sequence，Shot 归属 Sequence |
| 场景 | Scene 是场所资产，已有 spatial_layout 等结构化字段 | 场所资产继续复用；一次具体事件的时间、人物关系与临时状态归场次 |
| 分镜来源 | ScriptDividerAgent 以 script_text 输入直接产出分镜；章节入口提供立即提取分镜 | 先划分场次、确定节拍与调度，再细化镜头；资产/对白提取仍作为准备能力 |
| 镜头设计 | ShotDetail 已有景别、角度、运镜、时长、action_beats | 补足叙事目的、刺激与反应、角色任务、空间锚点、入口/出口状态 |
| 连续性 | shot_video_prompt_pack 基于邻镜摘要、同场景关系等拼装 guidance | 将已确认的具体状态及实际采用素材作为依据，不能把通用提醒视作核验通过 |
| 生成底座 | 已有独立 PromptRenderer、提交快照、任务、文件、媒体分组和 Publisher | 继续复用，新增导演业务编排和 Take 目标，避免另建执行系统 |
| 视频采用 | ShotVideoPublisher 用 CAS 更新 generated_video_file_id | 生成成功先保存候选 Take，审片后显式采用；并发保护移到采用操作 |
| 历史追溯 | 已有任务输入、输出及文件记录 | 补足设计版本、最终提示词版本、审稿和 Take 的业务关联；CAS 计数不是提示词历史 |
| 后期 | VideoEditor 的剪切、预览、导出按钮尚未绑定实际操作；timeline 路由是占位 | “审片—保留片段—粗剪—补拍”需要实现最小可用时间线，不能假定已有完整编辑器 |

本次核查入口：

- `backend/app/models/studio_projects.py`
- `backend/app/models/studio_shots.py`
- `backend/app/models/studio_assets.py`
- `backend/app/chains/agents/script_divider_agent.py`
- `backend/app/services/studio/shot_video_prompt_pack.py`
- `backend/app/services/studio/shot_video_readiness.py`
- `backend/app/services/generation/prompts/renderers.py`
- `backend/app/services/generation/gate.py`
- `backend/app/services/generation/publishers/shot_video.py`
- `backend/app/api/v1/routes/studio/generation_tasks.py`
- `backend/app/api/v1/routes/studio/timeline.py`
- `front/src/pages/aiStudio/project/ProjectWorkbench/tabs/ChaptersTab.tsx`
- `front/src/pages/aiStudio/chapter/ChapterStudio.tsx`
- `front/src/pages/aiStudio/editor/VideoEditor.tsx`

## 3. 哪些方法采用，哪些做产品化调整

参考项目把六个角色定义为协作职责，明确不等于自动启动六个 Agent。其工作协议强调共享场次事实、先设计后编译、逐角色逐镜检查以及结果追溯。见 [README](https://github.com/MasterLeos/leos-six-department-directing-team-skill-v1) 和 [工作协议](https://github.com/MasterLeos/leos-six-department-directing-team-skill-v1/blob/main/SKILL.md)。

| 方法 | 建议 |
| --- | --- |
| 场次目的、空间关系先于镜头细化 | 作为主流程；复杂多人场面必须有可检查的共享空间依据 |
| 六岗职责与裁决权 | 采用字段职责和分阶段产出；各岗提出修改建议，总导演汇总，用户确认后成为设计真值 |
| 先确认设计再编译 | 采用“确认方案并编译”动作；不要求用户重复输入授权句 |
| 逐镜审稿 | 完整审稿保存六角色 × N 镜记录，前端默认聚合问题；保留通过记录，不能用总评冒充覆盖 |
| 固定纯文本模板、5000 字上限 | 可做特定编译模板规则；内部仍使用强类型结构，输出格式和长度按实际模型能力校验 |
| 未明确技术参数不补默认 | 项目中显式设定的默认值可以继承并展示来源；必填而未设置的参数要求补齐 |
| 连续性入口与出口 | 同时记录计划状态和实际采用素材状态，明确证据；不能以提示词描述代替成片观察 |
| 审片与最小返工 | 保存可用区间和诊断，优先剪辑、补反应/过渡镜头，再考虑整场重做 |
| 经验沉淀 | 先保存项目经验候选及证据，不自动修改全局技能或系统提示词 |

逐镜覆盖的依据见 [角色协作与审稿](https://github.com/MasterLeos/leos-six-department-directing-team-skill-v1/blob/main/references/role-council.md)；模板限制见 [输出契约](https://github.com/MasterLeos/leos-six-department-directing-team-skill-v1/blob/main/references/output-contracts.md)。结构检查只证明记录完整，不能证明表演或空间正确。

## 4. 工作台与页面分工

顶层工作台建议突出“剧本与场次、导演准备、生成工作室、审片与粗剪”，演员、角色、场景、道具、服装归入资产区，继续支持独立管理。六个岗位出现在对应方案栏目和审查意见中，不另建六个导航页。

| 阶段 / 页面 | 用户主要动作 | 持久化产物与完成条件 |
| --- | --- | --- |
| 章节 / 场次列表 | 划分场次、确认原文范围、核对角色/场所/对白 | Sequence 与事实准备；保留原文来源，推断和待确认项分开 |
| 场次导演准备 | 确认本场目的、观众视点、关键节拍、人物空间与动作安排 | 有版本的场次设计；必要冲突解决，用户确认 |
| 分镜准备页 | 在场次设计下拆镜、确认资产/对白、调整表演和摄影覆盖 | Shot 与镜头设计；基础提取状态和设计确认状态分别展示 |
| 生成工作室 | 选择参考资产、准备关键帧、编译/编辑提示词、审稿、提交试拍 | 固定设计和提示词版本的生成包；按实际模型检查准备度 |
| 审片面板 | 对比 Take、标记问题时间码、选择可用区间、采用或补拍 | 人工裁决、实际入口/出口状态、采用片段和返工建议 |
| 场次粗剪 | 排列采用片段、查看接缝、调整出入点、定位缺镜 | 可保存、播放的粗剪；局部问题回到对应镜头或设计层 |

场次导演准备和分镜准备共同承担“准备”，工作室承担“生成准备、执行、查看结果”，任务中心仍只显示通用进度、结果和回跳。工作室发现事实未确认时返回准备页；发现创作设计过期时返回对应方案位置。

六岗产出建议是：总导演的场次意图和节拍、表演指导的动作与反应、镜内执行的背景人物任务、摄影指导的构图和运动方案、提示词导演的编译结果、场记的连续性与版本记录。按职责限定可修改字段，禁止直接互相覆盖。

例：哥哥在面馆借钱，弟弟回避。先确定“弟弟从装作没听懂到被迫回应”的场次变化，再设计擦桌停顿、目光转移和两人的位置关系，最后决定需要关系镜头、动作细节和反应镜头。这样镜头数量由叙事需要产生。

## 5. 数据模型与单一真值

以下是职责划分，不要求每项立即拆成多张表。第一版可将一轮场次设计保存为经契约校验的结构化快照，避免把六岗工作单全部表格化。

| 对象 | 最小职责 |
| --- | --- |
| Sequence | 章节归属、顺序、原文范围、主要场所引用；相同场所可以出现在多个场次 |
| DirectionRevision | 场次目的、节拍、共享空间、人物任务、镜头设计、连续性计划、项目风格快照、确认信息 |
| Shot | 场次归属、顺序、原文和提取确认；已批准的导演字段以 DirectionRevision 内镜头设计为准 |
| PromptRevision | 对应设计版本、镜头范围、完整执行文本、参考 file_id 及职责、模型与参数、修改摘要 |
| Review | 明确审查对象是设计、提示词或 Take；保存岗位、镜头、问题、证据、严重程度和裁决 |
| Take | 一次成功视频产物与对应任务输出、提示词版本的关联；审片结论属于业务状态 |
| TimelineClip | 所属项目/场次、Take 来源、素材入点/出点、时间线起点和轨道；采用状态由片段引用表达 |

不能在 ShotDetail、部门报告和 PromptRevision 中维护三套可编辑摄影真值。目标是准备页修改设计草稿，确认生成不可变版本，提示词从该版本派生。原有摄影字段需要迁入设计或降为只读投影，并清除旧写入口。

修改设计产生新版本；旧版、旧提示词和旧 Take 保留业务追溯意义。这是新流程自身的版本管理，不是历史兼容层。

### 镜头、生成段和 Take 的区别

参考方案允许一次生成包含多个镜头，并按稳定空间或戏剧小节组织生成段，见 [生成控制](https://github.com/MasterLeos/leos-six-department-directing-team-skill-v1/blob/main/references/generation-control.md)。

第一版建议一镜对应一个生成段、一镜可有多个 Take，先形成可控闭环，不实现多镜自动切分。支持一条视频覆盖多个镜头时，再显式引入 GenerationSegment 和镜头覆盖关系，Take 归属生成段，TimelineClip 通过素材区间对应镜头；不能把同一个文件复制挂到多个镜头并假装它们是独立生成。

## 6. 状态、版本与连续性

- `shot.status` 继续只表示信息提取确认，保持 `pending / ready`，不承担设计或生成状态。
- 设计版本区分草稿、待确认、已确认；是否过期由依赖版本是否匹配计算。
- 提示词区分草稿、已审、已批准；编辑文本或更换参考图/参数会产生新版本，使旧批准不再适用于新内容。
- runtime task status 继续归任务系统。
- `video-readiness` 聚合业务方案、审稿、参数、媒体和模型条件，列出具体缺口及回跳位置。
- Take 审片结论和片段采用关系分离；一个 Take 可有多个可用区间，生成成功不代表已采用。

设计、参考资产或提示词变化时，仅使依赖它们的预览/审查待更新，不删除已有结果，不自动重新生成全章。首版先做到场次及引用级影响判断，不必建设通用依赖图引擎。

连续性分两层：计划阶段依据已确认的入口/出口；审片后用实际采用区间的代表帧、时间码和人工确认状态核对。未知实际状态标记待核验。若后镜依赖前镜实际落幅，必须等前镜选定；不依赖实际素材的镜头可以按计划并行试拍。

场次内部顺序和剪辑后的相邻片段可能不同，不能长期依靠 `shot.index ± 1` 判断所有接缝。跨场次、插叙或有意跳轴应记录转换意图，而非机械要求全部状态相同。

## 7. 服务集成与现有决策的关系

推荐业务链：

```text
导演业务服务 → 已确认设计 → 提示词编译与审查
→ 工作台业务提交检查 → GenerationSubmitter
→ 现有 Worker / Provider / 文件归档 → Take 候选
→ 审片采用服务 → TimelineClip
```

- `api` 层处理参数、鉴权、响应；设计、确认、失效和采用规则放 `services`。
- 新增导演工作流通用 DTO 放 `app/core/contracts`，任务模块只负责编排执行。
- 按固定阶段复用现有文本 Agent 能力：初始设计、部门细化、汇总、编译、审查。六岗可以共享模型，调用次数由阶段需要决定，不建设自由交谈的多 Agent 框架。
- 模型输出只能作为草稿或修改建议，批准、覆盖范围校验和版本关系由服务落实。人工修改保留来源，后续模型任务不能无声覆盖。
- 渲染阶段完成编译；批准后的提交只消费保存的最终文本和媒体，不二次改写。
- 通用 GenerationEntityGate 保持目标、模型、文件等实体校验。导演业务门禁放在工作台提交服务；实验室仍可以直接实验最终提示词。
- 必须替换工作台旧的直接提交路径，避免只在前端禁用按钮。公共 API、OpenAPI 和前端 generated client 一起切换。
- Take 使用现有 TaskOutput / FileItem 建立关联，不复制一套文件库。重复任务回调不得创建重复 Take；迟到结果只能进入候选，不能替换已采用片段。
- 不把艺术判断全部变成硬阻断：缺失版本、引用错误、未解决的明确硬冲突阻止正式提交；审美建议可以人工裁决。试拍也需要明确所依据的设计和试验目的。
- 网络失败和供应商临时错误走技术重试；生成内容不满意才走带诊断的创作返工，两者不要混为“必须改提示词”。

[统一生成编排计划](/docs/plans/unified-generation-orchestration-plan/) 当前写有允许最终提示词自由编辑、只做实体门禁的决策。本提案明确建议改变工作台正式生成的业务规则，保留底层执行职责；若采纳，必须同步修订该计划对应范围，而不能声称现有系统已经具备导演批准检查。

## 8. 实施次序与验收

| 阶段 | 实施范围 | 验收条件 |
| --- | --- | --- |
| P1 场次与导演准备 | Sequence、设计版本、场次拆解、分镜归属；调整章节与准备入口 | 同一场所可复用在两场不同事件；分镜能追溯到确认后的场次设计；模型建议不会覆盖人工定案 |
| P2 编译与正式生成 | 新的提示词版本、审稿、readiness、工作台提交服务；关键帧和视频同源 | 漏审/重复审查可检测；修改文本、资产或设计后旧批准失效；实际任务输入与批准内容一致；单镜和批量不可绕过规则 |
| P3 Take 与局部返工 | 视频成功保存候选、审片、采用区间、诊断和补拍 | 两次成功保留两个 Take；重复回调不重复写入；新结果不自动替换人工选择；能只补一个反应镜头 |
| P4 最小场次粗剪 | 有项目归属的时间线、入出点、顺序、连续播放与保存 | 刷新后顺序和区间一致；能从接缝问题回跳镜头；修改前镜采用片段后相关连续性检查待更新 |

P1/P2 验证前半程，P3/P4 才完成“生成—审片—粗剪—补拍”闭环。不能把 P2 完成称为整个融合完成。首轮不扩展完整专业剪辑、多镜自动切分、全局经验自学习。

建议用双人对话、道具交接、多人反应三个样例验收，固定源素材、模型和预算，记录：一次可用片段比例、跨镜硬错误、人工确认耗时、每段采用素材的生成次数/成本和返工范围。由人查看实际视频；结构检查和模型自评不能替代成片评估，也不预设收益百分比。

代码实施后必须同步 API/OpenAPI/generated client，并运行相关后端测试和前端 `pnpm exec tsc --noEmit`。状态迁移、过期审批、并发采用、重复回调和批量绕过应有针对性用例。

采纳并实施时同步更新 `architecture/shot-page-boundary.md`、`architecture/shot-status-flow.md`、`architecture/generation-workspace.md` 等当前架构文档，以及 AGENTS.md 中已变更的主流程；本次仅在 plans 记录提案，历史 release note 不改。

## 9. 引用与复用边界

- [参考仓库](https://github.com/MasterLeos/leos-six-department-directing-team-skill-v1)
- [空间与参考资产](https://github.com/MasterLeos/leos-six-department-directing-team-skill-v1/blob/main/references/spatial-and-assets.md)
- [审片与局部修复](https://github.com/MasterLeos/leos-six-department-directing-team-skill-v1/blob/main/references/review-and-repair.md)
- [连续性与经验记录](https://github.com/MasterLeos/leos-six-department-directing-team-skill-v1/blob/main/references/continuity-and-learning.md)

参考仓库 README 明确说明当前版本没有 LICENSE。本评估借鉴其流程思想并提出 Jellyfish 自身实现；若后续直接引入原文模板、脚本或参考资料，需先确认作者的复用授权。
