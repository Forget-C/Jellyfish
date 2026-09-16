# 场次工作台体验回归

从项目根目录运行既有纯行为回归，使用现有 TypeScript 编译器与 Node.js 内置测试工具：

```bash
node --test front/tests/workspaceUsage.test.mjs front/tests/workspaceNavigation.test.mjs front/tests/workspaceContext.test.mjs front/tests/workspaceGuidance.test.mjs front/tests/workspaceTaskContext.test.mjs front/tests/workspacePreparation.test.mjs front/tests/workspaceProduction.test.mjs front/tests/workspaceCut.test.mjs
```

浏览器回归需要 Node.js 20+、Playwright 及 Chromium；`workspaceUsage.browser.mjs` 与 `workspaceCut.browser.mjs` 还需 ffmpeg。可复用 Codex workspace runtime；如果 Playwright 不在项目模块路径，通过 `NODE_PATH` 指向提供该包的 `node_modules`，并使用该 runtime 的 Node.js。

```bash
node front/tests/workspaceUsage.browser.mjs
node front/tests/workspaceGuidance.browser.mjs
node front/tests/workspaceProduction.browser.mjs
node front/tests/workspaceCut.browser.mjs
node front/tests/workspaceAcceptance.browser.mjs
node front/tests/workspaceWrite.browser.mjs
```

六个脚本分别启动仅监听 `127.0.0.1:4178` 至 `127.0.0.1:4183` 的临时 Vite，在真实页面中拦截业务接口，不连接生产后端，不调用真实生成模型。运行结束关闭浏览器和临时服务，并输出截图证据目录。`workspaceAcceptance.browser.mjs` 同样需要 ffmpeg。

| 脚本 | 覆盖 |
| --- | --- |
| `workspaceUsage.browser.mjs` | A01–A04 采用与区间；八种旧入口、辅助定位、版本刷新、保存/放弃/取消、保存失败重试、不同草稿编辑器、并发审片及采用替换时的接缝保留。媒体为 ffmpeg 生成的六秒色卡。 |
| `workspaceGuidance.browser.mjs` | A05–A08 首次进入、下一步、来源变化、参考/能力拒绝定位、单元隔离、任务轮询与结果查看、焦点、章节/资产/任务往返、固定输入恢复和准备输入暂存及失败兜底。 |
| `workspaceProduction.browser.mjs` | A09–A12 及 A17 排队转执行：同源设计摘要、六岗与声音各字段编辑/保存/刷新、其他字段及 Note 状态/来源完整保留、保存和写入失败、迟到建议、成功/失败/取消任务与完整历史、跨计划同名单元隔离、多个指令显式选择、固定参数与媒体类型，以及验证图/批量/重组的实际请求。 |
| `workspaceCut.browser.mjs` | A13–A16：候选与采用并排、同一 Take 多区间、真实片段/预演混合播放、准确跳转提帧、重排/替换/保存刷新、采用替换后的局部依赖、画面/声音分开、问题及历史返工的精确往返、当前返工的局部计划和三类台账。六秒合成媒体支持 HTTP Range，以验证真实跳转位置。 |
| `workspaceAcceptance.browser.mjs` | A18：1440/1024/768/375 宽度 × 16 个页面状态，检查文档和路由实际滚动宽度、主要动作无遮挡、键盘焦点/折叠/选择/导航、窄屏主导航打开关闭及桌面侧栏。每个组合保留首屏和内容截图及 `results.json`，使用合成视频，不发业务写入。 |
| `workspaceWrite.browser.mjs` | A08/A09/A14 延迟写入保护：设计、计划、风格、反馈、剪辑、审片和接缝的成功/失败恢复；保存中后退、取消与完成后继续，媒体提示与整页恢复。不调用真实模型。 |

测试替身证明前端交互与请求边界。采用指针、不可变版本和事务规则由 `backend/tests/directing/test_store.py`、`test_continuity.py`、`test_feedback.py` 的现有业务测试验证；没有后端变化时复用已有结果。迟到建议的服务端独立派生由 `backend/tests/directing/test_workspace.py` 验证。A17 的场景矩阵由前四组综合覆盖；A18 为 Chromium CSS 视口检查，不宣称真实手机硬件或全部浏览器通过。这些脚本不证明真实模型艺术质量或目标用户理解。A19 五秒用户测试已由用户明确取消，不再作为本次 UX5 门槛；取消说明见 `site/content/docs/plans/directing-workbench-usability-check.md`。

## 全站布局框架回归（A1–A3）

```bash
node --test front/tests/shellNavigation.test.mjs
node front/tests/shellAcceptance.browser.mjs
node front/tests/shellFocus.browser.mjs
```

`shellAcceptance.browser.mjs` 使用同样的 Node.js / Playwright 环境，临时监听 `127.0.0.1:4184`。接口请求由测试替身隔离，不连接真实服务或调用模型。默认截图与测量数据位于 `/tmp/jellyfish-shell-acceptance`，可通过 `SHELL_EVIDENCE_DIR` 指定输出目录。

覆盖全部路由族、项目与资产页签、五种规定尺寸、全局导航、真实标题回跳、任务抽屉、资产与 Agent 保存、实验室历史与固定输入区，以及旧入口参数恢复。原场次回归继续负责业务草稿、采用、离开保护与复杂写入失败场景。

`shellFocus.browser.mjs` 临时监听 `127.0.0.1:4185`，验证桌面与手机导航的 Tab 往返、2px 可见焦点及 Escape 关闭；手机导航位于应用壳外的抽屉门户中，因此单独覆盖其焦点样式。

## 新场次工作台回归（B 阶段）

```bash
node --test front/tests/designWorkspace.test.mjs front/tests/workspaceTaskContext.test.mjs
node front/tests/sequenceWorkbench.browser.mjs
node front/tests/workspaceDesignViews.browser.mjs
node front/tests/workspaceJourney.browser.mjs
```

纯行为测试覆盖真实关联图、对象编辑时其他字段与来源保留、稳定身份版本比较。浏览器脚本使用 `127.0.0.1:4186`，检查参考 A 的布局边界、共享对象选择、1/60/200 镜头虚拟定位和1279/1024/768/375px 导航与详情抽屉。默认输出 `/tmp/jellyfish-sequence-workbench`，可通过 `SEQUENCE_EVIDENCE_DIR` 指定目录。此脚本的试拍与剪辑截图仅验证布局；完整媒体、采用及编辑保护仍由上述专门回归验证。B5 的最终证据与未完成项维护在全站布局和场次工作台计划中。

`workspaceDesignViews.browser.mjs` 使用4187端口，覆盖200镜头的节拍聚合、搜索和问题过滤、错版与多来源预演选择、稳定身份历史比较、版本切换后的选择恢复；只读浏览不产生业务写入。`workspaceJourney.browser.mjs` 使用4188端口和ffmpeg合成媒体，从新建项目、章节、场次连续执行到设计/计划确认、编译审稿、生成候选、人工审片、精确区间粗剪及局部返工。其接口替身按实际请求推进数据，不预先填充后续产出。

试拍回归还检查跨计划同名单元的运行/失败摘要及冻结来源抽屉；剪辑回归检查所选接缝两端实际区间和抽屉关闭、切换后的输入保留。综合响应式回归直接检查首屏按钮的尺寸和命中位置，不先滚动按钮以掩盖裁切。

布局截图也需要 `ffmpeg`：`sequenceWorkbench.browser.mjs` 生成六秒合成视频，并等待真实播放后暂停截图，避免把加载中的原生播放器作为最终视觉证据。

B5 响应式回归使用 1440×900、1024×768、768×1024、375×812，检查顶部保存/确认与底部播放控件的完整边界及实际命中，按钮不能进入状态栏覆盖范围。

### C 阶段交互与可读来源（已完成）

- `node --test front/tests/designWorkspace.test.mjs front/tests/sourceResolver.test.mjs`：范围、过滤编排、合法关联、完整来源身份去重、合批与失败重试。
- `node front/tests/workspaceRefinement.browser.mjs`：12镜头范围/视图/选择联动、节点布局与聚焦恢复、合法关联添加/解除、缺失引用修复、间接边定位、一对多试拍回跳、试拍筛选/滚动恢复及窄屏布局。
- `node front/tests/sourceProvenance.browser.mjs`：五类来源、历史原文与模型名称、失败重试、只读历史、返回保留编辑、迟到响应隔离。使用隔离接口与ffmpeg合成媒体，验证读取失败后重试、真实入点播放和出点暂停；不验证生成内容质量。

浏览器命令沿用上文 Playwright `NODE_PATH` 配置，各自启动4192/4193端口。测试结果和截图输出到独立临时目录。C5完整结果见 `site/static/images/directing-workbench/refinement/verification.json`：48项纯行为测试、8项后端来源/API测试、11组浏览器回归、四尺寸×16状态，以及1586×992框架几何。`workspaceDesignViews`另覆盖1/12/60/200镜头、表格/分镜滚动与版本隔离；`workspaceCut`核对精确片段、筛选、缩放及时间线重载恢复。后端Pylint的5项既有问题与验证边界在方案中单独记录。


### D阶段镜头视图与全场关系总览

```bash
node --test front/tests/*.test.mjs
node front/tests/workspaceSceneOverview.browser.mjs
node front/tests/workspaceDesignViews.browser.mjs
node front/tests/workspaceRefinement.browser.mjs
```

新增`workspaceSceneOverview.browser.mjs`沿用Node.js 20+、Playwright和上述`NODE_PATH`配置，监听本地4194端口，使用隔离接口替身，不调用真实模型。覆盖旧视图记忆映射、交错节拍的真实镜头顺序、未保存正文跨展示保留、共享高亮及真实路径、清除后重新选择、总览展开和滚动恢复、单节拍200镜头、无节拍及空场次创建。五种尺寸（1586×992、1440×900、1024×768、768×1024、375×812）分别检查分镜、清单、全场总览和节拍图的实际边界与主要控件命中，并保存20张截图及结果。

既有浏览器回归已适配“镜头 / 关系”和“分镜 / 清单”入口；全场不能再直接使用详细图缩放，测试需明确进入节拍。最终结果归档于`site/static/images/directing-workbench/scene-overview/`，与C阶段历史证据分开。

`node front/tests/workspaceAssets.browser.mjs`使用同一运行环境，在4195端口隔离验证本场资产有效计数、未保存内容保留、问题面板、刷新后筛选恢复、三种展示的空结果恢复、无效引用、加载失败重试、问题定位和375px资产入口。业务请求均由接口替身处理。
