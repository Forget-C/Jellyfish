---
title: "场次工作台版本管理交互改造计划"
description: "参照场次划分历史统一工作台版本列表、查看与编辑操作，将版本入口移至场次导航行右侧，保留独立版本与固定依据。"
date: 2026-09-30
weight: 38
status: completed
---

# 场次工作台版本管理交互改造计划

> 状态：P1–P4 实现与验收已完成（2026-09-30）。当前行为已同步架构文档，V01–V12 的证据与验证边界见末尾。
>
> 用户要求：工作台“版本与依据”采用与场次划分历史类似的版本管理交互；版本入口与“返回章节、场次选择 Select、上一场、下一场”处于同一行，并靠右显示。
>
> 承接[章节、场次与工作台交互优化任务计划](/docs/plans/chapter-sequence-workbench-interaction-plan/)，参照[场次划分统一编辑与历史版本计划](/docs/plans/chapter-division-version-editor-plan/)的列表与展开交互。保留前序已完成记录，本计划只调整工作台版本管理与入口布局。

## 1. 现状与改造结论

以下为改造前核对的事实与实施依据。

| 已核对的实现 | 本轮处理 |
| --- | --- |
| `WorkspaceVersionDialog` 通过多个下拉框选择设计、计划、剪辑；另一个页签嵌入 `WorkspaceHistory` 查看与比较 | 用同一个分类版本列表承载选择、详情、比较和进入编辑，减少往返查找 |
| `DivisionHistoryModal` 已采用表格、展开详情、查看版本和基于历史编辑 | 复用交互方式与 Ant Design 组件，不照搬章节划分接口、保存规则或任务列表 |
| `SequenceWorkspacePage` 中版本按钮位于 `SequenceSwitcher` 前方，独占一行并携带较长摘要 | 合并为一条导航行，按钮固定在右端，摘要移入版本弹窗 |
| 设计、计划、剪辑通过各自的 revision ID 管理；计划固定绑定设计，剪辑可能使用多个计划的素材 | 保留三类版本及真实引用，不创建场次总版本 |
| `DirectingStore` 原地更新未确认草稿，已确认版本修改须派生新 ID；`version` 用于并发控制 | 保留现有写入语义，不把每次草稿保存包装成独立历史快照 |
| `workspaceVersions.ts` 已维护计划与设计联动；页面统一执行草稿保护 | 复用选择校验与保护入口，不在列表内另建写入流程 |

结论：首期以现有 `WorkspaceRead` 和保存接口完成前端改造，无需数据库迁移或新建版本引擎。列表分页仅对已加载数据进行展示分页，不宣称减少接口读取量。

## 2. 范围与成功标准

本轮包含：导航行布局、统一版本列表、只读详情与比较、受保护的编辑切换、版本与依据摘要、相关测试和架构文档同步。

成功标准：

1. 设计、试拍、剪辑及当前场次的辅助视图使用同一个顶部版本入口；与返回章节、Select、上下场同排且右对齐，不再独占一行。
2. 用户可以在同一弹窗内识别版本、查看内容和依据、比较同类版本，并明确进入对应编辑区。
3. “编辑基线”“草稿／已确认”“当前采用”分别表达；列表选中态只表示浏览对象。
4. 浏览操作不修改编辑内容、工作台 URL、确认状态或当前采用；进入编辑仍经过现有草稿保护。
5. 选择历史计划带回其固定设计；选择剪辑不替换设计或计划；失效引用不自动选择最新对象。
6. 已确认内容的修改通过保存派生新版本；未确认草稿继续原地保存并执行并发校验。
7. 1440、1024、768、375px 下导航与版本操作可达，长场次名、空版本、读取失败均有明确表现。

本轮不包含：逐次草稿保存快照、场次总版本、一键回滚全部成果、删除历史、版本合并、自动采用、服务端历史分页、未落库 AI 建议与版本混排。指令和检查仍由试拍业务页按计划、单元身份管理。

## 3. 导航行布局

桌面布局示意：

```text
[返回章节] [当前场次 Select ▼] [上一场] [下一场]       [版本与依据]
```

- 左侧保留现有导航顺序，右侧按钮保留“版本与依据”名称；按钮仅用于打开弹窗。
- 导航行占满主工作区可用宽度，采用正常 flex 布局；右侧按钮通过剩余空间靠右，不使用绝对定位悬浮覆盖。
- Select 可收缩、长名称省略，完整名称在下拉选项中可读；版本按钮不附带设计、计划、剪辑的长摘要。
- 将当前三个版本、计划固定依据及剪辑采用状态放在弹窗顶部；业务编辑区已有的版本状态继续保留。
- 移除主内容区原来的独立版本按钮和辅助侧栏重复的“版本与历史”总入口。失效版本提示中的定向恢复操作仍可打开同一个弹窗。
- 优先在 `SequenceSwitcher` 增加一个用于右侧操作的局部插槽，由页面传入按钮；版本状态仍由页面维护，不抽象全站通用页头。

响应式要求：

| 宽度 | 导航行表现 |
| --- | --- |
| 1440／1024px | 完整按钮文字，Select 在可用空间内伸缩，版本入口右对齐；侧栏展开或收起不改变对齐规则 |
| 768px | 缩短 Select 宽度，必要时将上下场改为带可访问名称的箭头按钮，保留同行布局 |
| 375px | 返回章节与上下场采用图标按钮，Select 显示省略名称，版本按钮可缩为“版本”并保留完整可访问名称；版本按钮仍与其余四项同行、靠右 |

紧凑布局下，`SequenceLayout` 现有“场次导航”按钮是右上角绝对定位，需要同步调整到独立的紧凑工具区，沿用原抽屉行为，避免遮挡版本入口。场次列表重试提示可以位于导航行下方，不挤走右侧按钮。图标按钮须有可访问名称与提示，触屏不能依赖悬停才能操作。

## 4. 统一版本弹窗

### 4.1 分类与列表

保留 Modal，标题为“版本与依据”。顶部显示当前工作上下文，下面只有“设计／生产计划／剪辑”三个分类，不再先让用户选择“切换版本”或“查看与比较”。正常入口按当前业务阶段打开对应分类；失效版本恢复入口明确定位对应分类与错误。

| 列 | 内容 |
| --- | --- |
| 版本 | 沿用设计、计划、剪辑的现有名称；编辑基线单独标记 |
| 状态 | 草稿或已确认；剪辑另标服务端核实的当前采用 |
| 创建时间 | 使用 `created_at` 按浏览器本地时间显示，缺失时说明未提供 |
| 依据／来源 | 派生父版本、固定设计或素材来源摘要；展开补齐具体内容 |
| 操作 | 查看版本、加入比较，以及与状态对应的编辑操作 |

- 每页 10 条，默认按创建时间倒序；缺少时间的条目保留原有顺序并放在后面。
- 版本名称从完整、未筛选的原始集合按 ID 取得，再进行排序与分页。现有 `revisionName` 对设计、计划、剪辑使用集合序号，不能用分页后的下标重新编号，也不能用 CAS `version` 冒充历史版本号。
- 此期不承诺设计、计划、剪辑具有服务端持久化的 `vN` 编号。若以后需要跨集合变化仍固定的展示编号，单独评估契约与存储调整。
- 生产计划列表展示全部计划，并可按固定设计筛选；不再用第二个下拉框才能找到其他设计的计划。
- 窄屏将时间和完整依据收进展开区，保留版本、状态和操作；列表空状态、工作区读取失败、采用状态未知分别表达。
- 翻页、展开和关闭弹窗不会写入。轮询新增数据时保留仍有效的浏览与比较对象，不自动跳到最新版本；切换场次时重置弹窗局部状态。

### 4.2 查看与比较

展开行展示版本摘要、派生关系和引用；“查看版本”在同一弹窗内进入只读详情，并可返回原列表、页码与展开位置。复用 `WorkspaceHistory` 的现有详情与 `revisionDifferences`，避免再叠一层 Drawer 或 Modal。

- 设计：只读设计内容和来源。
- 计划：固定设计、生产单元和参考依据，优先复用现有 `PlanEditor` 只读模式；设计缺失时说明缺失，不拿当前设计替代。
- 剪辑：真实素材、源区间和预演分别展示；通过 Take 追溯原计划与单元，保留跨计划来源。
- 比较仅允许两个同类版本；增删、顺序、字段与来源差异继续按稳定身份计算。比较对象与业务编辑基线分开保存。
- 草稿详情展示服务器当前保存的修订，不宣称拥有草稿每次保存的历史。缺少 AI 任务来源等信息时说明未记录，不从相邻任务或时间推断。

### 4.3 进入编辑

| 操作 | 结果与边界 |
| --- | --- |
| 查看版本／比较 | 只改变弹窗内浏览状态，保留页面未保存草稿 |
| 继续编辑草稿 | 经过草稿保护后载入该草稿，进入对应阶段；后续保存仍使用原 ID 与起始并发版本 |
| 基于此版本编辑 | 针对已确认版本，经过草稿保护后以该版本为编辑基线；点击本身不创建版本，修改并保存时传原版本 `parent_id` 派生 |
| 新剪辑草稿 | 保留现有明确进入空剪辑草稿的能力，经过草稿保护；不改变当前采用 |

编辑动作复用 `draftStatus.transition` 与现有保存／放弃／继续编辑选择，不因纯查看触发草稿确认。保存失败、冲突或响应未核实时保留输入与目标，不继续切换；保存成功后再基于最新上下文应用用户明确选择的目标，不能把保存派生结果误当成待选版本。

进入设计编辑时，若现有计划绑定其他设计，清空计划选择并说明原计划保留；不自动为新设计派生计划。进入计划编辑时，一并载入其固定设计，按该计划与单元身份恢复有效指令和检查。进入剪辑编辑只切换剪辑；任何编辑切换都不确认版本或更新采用指针。

历史场次（`is_current=false`）继续只读：可复用列表、详情与比较，但不显示编辑或新建操作；原有设计／计划／剪辑深链接仍定位指定对象。不存在或归属不符的对象明确报错，不能静默替换。

## 5. 实施任务与验证方式

| 阶段 | 实施内容 | 主要位置 | 验证方式 |
| --- | --- | --- | --- |
| P1 入口与布局 | 合并导航行、右侧版本入口、压缩摘要、处理紧凑导航按钮与重复入口 | `SequenceWorkspacePage.tsx`、`SequenceSwitcher.tsx`、`SequenceLayout.tsx`、`workspace.css` | 四尺寸截图与位置断言；长名称、加载失败、首尾场次、键盘焦点和侧栏伸缩检查 |
| P2 列表与只读浏览 | 分类表格、展示分页、详情、同类比较、来源及状态摘要 | `WorkspaceVersionDialog.tsx`、`WorkspaceHistory.tsx`、`workspaceUsage.ts` | 查看／翻页／比较不产生业务写入；编号不随展示排序变化；跨计划素材、缺失依据和空状态检查 |
| P3 编辑衔接 | 将行操作接入现有草稿保护和阶段切换，保留空剪辑入口、深链接与历史只读 | `SequenceWorkspacePage.tsx`、`workspaceVersions.ts`、必要的 `CutEditor.tsx` 调整 | 草稿保留与冲突、确认版本派生、计划固定设计、剪辑独立选择、历史只读回归 |
| P4 回归与文档 | 补齐受影响测试，核对主流程，落地后更新架构当前事实并记录验收证据 | `front/tests`、`directing-foundation.md`、本计划 | 类型检查、相关单元与浏览器回归；逐项记录下方矩阵结果和限制 |

按 P1 → P2 → P3 → P4 执行。仅复用同语义的现有实现；若拆出版本表格，限定在工作台领域，不将章节划分与工作台强行合并成通用版本系统。

首期不修改后端或 OpenAPI。若实施发现已有字段不足，先记录具体缺口并更新计划范围；对外契约实际改变时，再按项目规则同步后端、OpenAPI 与 generated client，补充后端测试和 Pylint。

## 6. 验收矩阵

| 编号 | 场景 | 通过标准 |
| --- | --- | --- |
| V01 | 1440／1024／768／375px 导航行 | 返回章节、Select、上下场、版本入口同行；版本入口在最右侧；无页面横向溢出、遮挡或无法点击 |
| V02 | 长场次名、首尾场次、列表读取失败、侧栏伸缩 | 名称可省略且完整信息可读；上下场禁用正确；重试不挤掉版本按钮 |
| V03 | 打开、翻页、展开、查看、比较、关闭 | 页面草稿、工作上下文 URL 和采用不变；不产生保存、确认、生成或拍摄请求；关闭后焦点回到入口 |
| V04 | 不同状态和列表排序 | 草稿、已确认、编辑基线、当前采用可区分；未知采用不显示为未采用；排序分页不重新编号 |
| V05 | 进入其他草稿，存在本地修改 | 保存后继续／放弃后继续／继续编辑三条路径正确；纯查看不弹草稿保护 |
| V06 | 保存派生后切换、保存失败与冲突 | 成功后进入明确目标；失败保留输入和目标；不误选新派生版本，不重复写入 |
| V07 | 以已确认设计、计划或剪辑为基础修改 | 进入编辑不创建版本；保存后产生新 ID 与正确 `parent_id`，旧版本内容和历史引用不变 |
| V08 | 切换计划与设计 | 计划带回固定设计；设计变化清除不匹配计划选择；不自动创建计划、重编译或拍摄 |
| V09 | 切换剪辑、创建空剪辑、混合计划素材 | 设计与计划上下文不变；真实来源可追溯；当前采用不因编辑切换或草稿保存改变 |
| V10 | 缺失对象、跨场引用、缺失时间和来源 | 明确提示，不自动用最新对象替代，不虚构编号、时间或来源 |
| V11 | 历史场次与带版本参数的深链接 | 保留指定对象身份，只读浏览和比较可用，编辑与新建不可用 |
| V12 | 设计 → 试拍 → 剪辑主流程与同章切场 | 阶段入口正常，指令／检查按计划和单元恢复；切场不携带上一场版本身份 |

## 7. 验证命令与完成记录

实施后从项目根目录执行，复用现有测试并调整受影响的交互断言；新增测试仅覆盖缺失的行为和边界：

```bash
pnpm --dir front run typecheck
node --test front/tests/workspaceVersions.test.mjs front/tests/workspaceUsage.test.mjs front/tests/workspaceContext.test.mjs front/tests/workspaceNavigation.test.mjs
node front/tests/workspaceVersions.browser.mjs
node front/tests/chapterSequenceNavigation.browser.mjs
node front/tests/workspaceJourney.browser.mjs
```

浏览器脚本依赖本地可用的 Playwright／Chromium，并自行启动 Vite；按脚本现有约定顺序运行，避免端口冲突。检查失败或依赖缺失时记录原因，不以类型检查代替布局和行为验收。涉及剪辑保存或选择处理时，补跑现有 `workspaceCut.test.mjs` 与 `workspaceCut.browser.mjs`。

四尺寸证据至少包含导航行、版本列表、详情／比较；验证按钮矩形处于同一行且右侧留白与导航容器一致，并实际点击或键盘触发，不能仅凭截图判断。浏览器回归使用隔离数据，不调用收费模型或修改业务库。

- [x] P1 入口与布局完成。
- [x] P2 列表与只读浏览完成。
- [x] P3 编辑衔接完成。
- [x] P4 检查通过，V01–V12 逐项记录结果、证据和未完成项。
- [x] 实施后更新架构文档“章节入口与工作上下文”相关事实；本计划只保留方案、进展与验收记录。

实现已接入现有前端版本与草稿流程；本轮未修改后端和 OpenAPI。


## 8. 实施结果与验收记录（2026-09-30）

### 8.1 落地范围

- P1：`SequenceSwitcher.actions` 承载右侧唯一版本入口；场次 Select 可伸缩，窄屏使用带完整可访问名称的紧凑按钮；移动导航抽屉入口移入独立工具区。原独立版本行、侧栏及阶段菜单重复总入口已移除。
- P2：`WorkspaceHistory` 统一分类表格、展开依据、完整只读详情、同类版本比较与展示分页；正常弹窗和历史场次复用同一浏览实现。计划详情可以选择查看每个单元，依据缺失时明确报错。
- P3：行内编辑动作复用 `selectWorkspaceVersion`、统一草稿保护和原保存函数；编辑前后校验目标归属与固定设计，失败保留输入，保存派生后仍应用明确目标。进入计划编辑定位拍摄准备，剪辑仍可明确新建空草稿。
- P4：类型检查、28 项纯行为测试、8 组隔离浏览器回归通过；同步[当前架构](/docs/architecture/directing-foundation/)。原有章节划分改动保留，本轮未改变后端契约、生成接口或采用规则。

### 8.2 验收矩阵结果

| 编号 | 结果 | 证据与实际覆盖 |
| --- | --- | --- |
| V01 | 通过 | `workspaceVersions.browser.mjs` 在四尺寸比较五个控件中心线与右侧边缘，实际命中检查版本按钮；归档导航截图见下表 |
| V02 | 通过 | 长场次名省略、首尾上下场禁用、列表失败与重试；1440px 折叠、展开及键盘调整侧栏后版本入口仍靠右 |
| V03 | 通过 | 查看、比较、翻页、返回列表与关闭不写入；版本与工作上下文保留；Escape、Enter 和关闭后入口焦点恢复 |
| V04 | 通过 | 编辑基线／草稿／确认／采用分别展示；未知采用保持待核对；创建时间排序、缺失时间、分页编号及筛选空结果有回归 |
| V05 | 通过 | `workspaceVersions` 与 `workspaceUsage` 覆盖只读浏览脏草稿、取消、保存后继续、放弃后继续，以及设计／计划／剪辑和其他编辑器保护 |
| V06 | 通过 | 保存失败与 409 冲突保留原内容和工作上下文；原地重试后应用明确目标，设计／计划派生不误切到刚保存的版本 |
| V07 | 通过 | 设计、计划、剪辑的已确认基线保存传入正确 `parent_id` 并得到新 ID；旧内容不变；已有剪辑草稿按 `revision_id + expected_version` 保存 |
| V08 | 通过 | 新设计清空不匹配的计划选择，选择计划恢复固定设计；`workspaceProduction` 验证跨计划同名单元与固定执行输入隔离 |
| V09 | 通过 | 剪辑切换及空草稿保持采用和设计／计划上下文；跨计划素材依据及预演分别展示；`workspaceCut` 验证真实区间、采用和返工 |
| V10 | 通过 | 缺失设计／剪辑深链接保留错误身份直至明确恢复；缺失固定设计和跨场版本禁止编辑／替代查看；时间、来源、空列表与工作区读取失败分别展示 |
| V11 | 通过 | 历史场次按深链接查看版本，共用列表与比较但没有编辑／新建入口；缺失身份显示错误 |
| V12 | 通过 | `chapterSequenceNavigation` 验证同章切场与浏览上下文；`workspaceJourney` 从新建项目到设计、拍摄、采用粗剪、章节组合和局部返工完整通过 |

### 8.3 命令与证据

- `pnpm --dir front run typecheck`：通过。
- 第 7 节的四个纯逻辑测试文件，加 `front/tests/workspaceCut.test.mjs`：28 项通过、0 失败。
- 第 7 节的三个浏览器脚本，以及 `workspaceCut.browser.mjs`、`workspaceUsage.browser.mjs`、`workspaceDesignViews.browser.mjs`、`workspaceProduction.browser.mjs`、`workspaceAcceptance.browser.mjs`：8 组均通过。
- `workspaceAcceptance` 覆盖 4 种尺寸 × 16 种页面状态，检查主要操作命中与文档宽度；时间线自身允许局部滚动，不代表页面溢出。
- 相关修改的 `git diff --check`：通过。

浏览器运行使用本机 workspace runtime 的 Node.js 24.19.0，并将其 `node_modules` 设置为 `NODE_PATH`；启动本机 Vite／Chromium 的权限已取得。前两次新列表截图捕获到了入场动画，最终证据改为等待弹窗进入稳定状态后拍摄，不使用过渡帧作为验收图。

归档目录：`site/static/images/directing-workbench/version-management/`。

| 尺寸 | 导航行 | 版本列表 | 只读详情 | 版本比较 |
| --- | --- | --- | --- | --- |
| 1440px | [截图](/images/directing-workbench/version-management/navigation-1440.png) | [截图](/images/directing-workbench/version-management/versions-1440.png) | [截图](/images/directing-workbench/version-management/detail-1440.png) | [截图](/images/directing-workbench/version-management/compare-1440.png) |
| 1024px | [截图](/images/directing-workbench/version-management/navigation-1024.png) | [截图](/images/directing-workbench/version-management/versions-1024.png) | [截图](/images/directing-workbench/version-management/detail-1024.png) | [截图](/images/directing-workbench/version-management/compare-1024.png) |
| 768px | [截图](/images/directing-workbench/version-management/navigation-768.png) | [截图](/images/directing-workbench/version-management/versions-768.png) | [截图](/images/directing-workbench/version-management/detail-768.png) | [截图](/images/directing-workbench/version-management/compare-768.png) |
| 375px | [截图](/images/directing-workbench/version-management/navigation-375.png) | [截图](/images/directing-workbench/version-management/versions-375.png) | [截图](/images/directing-workbench/version-management/detail-375.png) | [截图](/images/directing-workbench/version-management/compare-375.png) |

机器可读记录：[验证汇总](/images/directing-workbench/version-management/validation.json)、[版本交互](/images/directing-workbench/version-management/versions-results.json)、[完整主流程](/images/directing-workbench/version-management/journey-results.json)、[设计视图](/images/directing-workbench/version-management/design-views-results.json)、[64 状态布局](/images/directing-workbench/version-management/layout-results.json)。

### 8.4 验证边界与未完成项

本计划范围内无未完成项。浏览器回归使用隔离业务接口与合成媒体，证明前端交互、请求内容和 Chromium CSS 视口表现；不宣称真实手机硬件、全部浏览器、业务数据库事务或真实模型生成质量已重新验证。后端与 OpenAPI 未因本计划改变，因此未重新运行后端测试、Pylint 或接口生成。服务端分页、持久化展示编号、逐次草稿快照仍是明确排除项。
