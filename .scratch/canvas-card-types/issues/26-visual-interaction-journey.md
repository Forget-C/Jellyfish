# 26: 完整创作旅程与视觉交互验收收口

**What to build:** 用户在完成对齐的生成画布中连续完成添加、编辑、连接、采用、筛选、生成、历史查看和恢复，整个旅程在桌面和窄屏下保持与场次工作台一致的布局和基本交互。

**Blocked by:** 21, 22, 24, 25

**Status:** ready-for-agent

**Completion:** integrated

- [x] 串联左侧添加文本／命名图片参考／导演及模型卡、编辑保存、建立直接候选、明确采用、筛选隐藏来源、预检和执行、查看历史及恢复重开，真实请求符合原协议且不因页面展示变化修改采用。
- [x] 对照场次工作台真实页，在同视口、同主题及相同比例下保存成对截图和逐区域核对结果，覆盖顶部菜单与按钮、面包屑、筛选、添加入口、卡片、右侧详情、底部工具及小地图；业务内容与端点差异须对应规格。
- [x] 桌面 1440px、窄屏 390px 及参考图宽屏排列均核对，默认、选中、连接中、编辑中、运行中、错误和按钮禁用／加载／焦点状态均可读，无遮挡、越界或页面横向溢出。
- [x] 组合打开列表、菜单、详情、预检、记录和任务入口时，层级与避让正确；内层 Escape、关闭恢复焦点、触摸与键盘可达，编辑器不重建，未保存输入与媒体上下文不丢失，浮层不移动画布。
- [x] 修复跨票组合中的操作误触、状态冲突和遮挡；连续输入自动保存、所有权只读、保存冲突、未知请求结果核实、任务取消、诊断定位及任务回跳继续可用，关闭容器不终止任务。
- [x] 按实际影响执行前端类型检查、工作台 UI／样式和受影响真实页面回归；复用已通过且实现及环境未变化的单票结果，HTTP 验证实际输入与运行行为，供应商及外部存储继续受控替身。
- [x] 各票自身验收必须已完成，本票只负责跨区域组合与最终覆盖核对，不以组件示例、暗色主题或历史 01–19 功能通过替代本次真实页面视觉与交互证据。
- [x] 记录真实命令、截图、交互结果、差异及环境限制，不预填通过，不声称真实供应商质量；不引入章节／场次试点、音频生成、新数据协议或强制组件复用。

规格依据：[页面布局与卡片交互](../spec.md#与场次工作台一致的页面布局)、[视觉与交互验收](../spec.md#本次布局视觉与交互验收增补)。共同边界见[任务索引](../README.md#布局对齐增补2026)。

## Comments

2026-10-29：用户已确认本票粒度与阻塞关系，仅发布任务，尚未开始实现。组件仅在符合当前功能规划时复用；卡片、端点、采用和生成规则保持不变。验收沿用 HTTP＋真实页面接缝，供应商与外部存储使用受控替身。

### 2026-10-29：跨区域实施与验收

- 独立工作树基于集成 `b630e69a`，20–25 全部 integrated 后开始；辅助旧浏览器迁移在独立工作树实施并合入本票。结束前同步集成分支；没有修改 01–19 或共享索引。
- TDD 接缝复用已确认真实页面与公开 HTTP。完整旅程先复现旧常驻入口失效，迁移到画布管理／添加列表／单详情后通过；补充筛选隐藏已采用描述、表演及命名参考后真实生成，实际 Worker 请求仍包含已采用内容，并验证结果另存和独立下游不跨级继承。
- 真实成对截图与逐区域核对见[布局验收记录](../layout-acceptance.md)。三视口为 1440×960／390×844／3830×1688，浏览器和默认画布比例一致；导演通过真实版本 HTTP 填充既有设计 fixture，不使用仿制页面。截图已实际查看，保存对应几何 JSON。
- 跨票核对发现并修复三处直接差异：面包屑留边 8px→工作台12px（真实几何先红后绿）；模型摘要暴露英文状态→与详情及历史共用中文状态（真实失败摘要先红后绿）；小地图180×120→复用工作台200×132、4px圆角、视口和关闭入口（真实几何先红后绿）。保持原卡片、端点、采用、保存及生成协议。
- 组合验收覆盖持续输入、展开／关闭／对象编辑、返回卡片焦点、列表与菜单、任务浮层、预检、受控运行／失败、正文保留，开合详情及关闭小地图不改变画布变换。失败截图等待页面收到真实终态后捕获，避免仅HTTP终态而页面仍在运行。
- 新统一入口为 canvas-layout。集成首轮前8例通过，末尾Journey出现一次动态下拉匹配项未形成预期候选边；没有降低HTTP断言，将选择明确作用于已核对的匹配项后完整Journey49.0s通过。最终小地图样式调整后仅重跑相关alignment／tools及typecheck；没有疑点的相同代码验证沿用。
- Node24 typecheck、脚本语法与 git diff --check 通过；未改后端或公开 schema，无需重复生成 OpenAPI。MySQL selection仅静态迁移并保留隔离MySQL守卫，未执行，不用SQLite冒充竞争验收。供应商和存储为受控替身，不声称真实生成质量。

本轮实际通过的独立真实浏览器用例共39项（24旧生成＋9布局／旅程＋6工作台），逐例命令结果与路径汇总 `/private/tmp/layout26-validation-summary.json`；旧例详细迁移记录 `/private/tmp/layout26-legacy-notes.md`。历史未改变实现的验收可按影响复用，不宣称所有旧例在同一个批次通过。

| 分组 | 通过用例及耗时（秒） |
| --- | --- |
| 布局／旅程 | generation-canvas-chrome 6.7；generation-canvas-filters 7.7；generation-canvas-card-list 9.3；generation-canvas-cards 7.0；generation-canvas-ports 5.9；generation-canvas-alignment-baseline 7.2；generation-canvas-alignment 8.5；generation-canvas-tools 6.3；generation-canvas-journey 49.0 |
| 既有生成 | generation-canvas 8.4；generation-canvas-autosave 19.7；generation-canvas-save 9.4；generation-canvas-graph 14.9；generation-canvas-media 9.3；generation-canvas-images 12.0；generation-canvas-performance 13.8；generation-canvas-lifecycle 9.3；generation-canvas-runtime 11.5；generation-canvas-history 14.5；generation-canvas-composer 10.2；generation-canvas-continuity 13.9；generation-canvas-sound 11.8；generation-canvas-video 14.5；generation-canvas-guidance 15.2；generation-canvas-visual-presets 13.6；generation-canvas-narrative 15.1；generation-canvas-mixed 9.0；generation-canvas-spatial 12.9；generation-canvas-photography 12.7；generation-canvas-multi-view 18.1；generation-canvas-video-bindings 13.4；generation-canvas-acceptance 7.7；generation-canvas-target 8.5 |
| 工作台 | workbench-ui 4.2；workbench-style 73.0；design-scope 15.8；unit-design 29.4；instruction-preparation 12.0；instruction-design 17.9 |

最终生成端视觉证据 `/private/tmp/layout26-map-final2/generation-canvas-alignment`，真实导演成对基准 `/private/tmp/layout26-paired-release/generation-canvas-alignment-baseline`；正文与实际Worker旅程 `/private/tmp/layout26-journey-release/generation-canvas-journey`。其他票据的自身验收继续以各自记录为准，本票不覆盖其历史证据。

- 2026-10-29 集成：26（分支 `39308b1d`，已同步全部20–25）无冲突合入当前集成分支。主区Node24 typecheck、差异检查及01–19哈希核对通过；产品代码与验收分支一致，复用本票39项真实浏览器、成对截图及最终小地图相关复测证据。20–26已全部integrated，最终双轴审查尚待后续记录；未清理工作树、未推送。


### 2026-10-29：最终 Spec 审查修复

- 两项 P2 均通过已确认的真实页面／HTTP 接缝先红后绿：关闭或切换详情后第 3 个结果重置（`/private/tmp/layout-review-session-red2`）；生成后修改依据，公开 runtime 已返回 `basis_current=false` 但问题筛选隐藏模型（`/private/tmp/layout-review-stale-red`）。
- 仅已访问卡片按稳定身份保留各自的隐藏详情／编辑会话，未访问卡片不挂载。仍由共享详情 provider 保证只有一个可见详情；隐藏内容不参与可访问选择，隐藏音视频暂停并保留当前位置，关闭及对象切换不重置预览结果。未修改共享详情组件、原票或采用规则。
- 问题筛选纳入已有失效输出；保存修订成功后通过现有 generated client 刷新运行投影，带 scope、编辑 generation、请求清理及 cursor 守卫，避免旧读取覆盖新范围／运行事件。未改变 schema、生成执行或自动采用。
- 新 `generation-canvas-sessions` 已注册布局套件，验证第 3 个结果在关闭／切换后保持、真实上传的 10 秒音频播放到 3 秒后关闭／切换暂停且保留 currentTime，以及保存后失效模型仍可筛出；最终 **8.9s passed**。截图 `/private/tmp/layout-review-final2/generation-canvas-sessions/stale-model-session.png` 已实际查看，后续冻结代码下新用例结果见 `/private/tmp/layout-review-layout-final`。
- 最终布局套件 **10 个真实用例全部通过**，其中原完整 Journey **50.8s**；原 Journey 及引用泄露／实际 Worker 输入断言均未修改。证据 `/private/tmp/layout-review-layout-final`。多结果图片回归见 `/private/tmp/layout-review-images-final`；运行 **10.3s**、自动保存 **18.6s**、保存恢复 **9.0s**，证据分别 `/private/tmp/layout-review-generation-canvas-runtime`、`/private/tmp/layout-review-generation-canvas-autosave`、`/private/tmp/layout-review-generation-canvas-save`。
- Node24 typecheck、差异检查通过。lint:check 仍仅原有三条 hooks 依赖警告（Graph inspectTarget 两条、useCardCandidates entity 一条），未新增且未修改基线来掩盖；不称 lint 通过。供应商及存储仍为受控替身，MySQL selection 未执行限制保留。历史 01–19 文件哈希保持不变。
