# 场次工作台体验回归

从项目根目录运行既有纯行为回归，使用现有 TypeScript 编译器与 Node.js 内置测试工具：

```bash
node --test front/tests/workspaceUsage.test.mjs front/tests/workspaceNavigation.test.mjs front/tests/workspaceContext.test.mjs front/tests/workspaceGuidance.test.mjs front/tests/workspaceTaskContext.test.mjs front/tests/workspacePreparation.test.mjs front/tests/workspaceProduction.test.mjs front/tests/workspaceCut.test.mjs
```

## 统一检查与浏览器入口

项目内 Node 版本见 `front/.node-version`。安装前端依赖并在 `backend` 执行 `uv sync --group dev`；浏览器回归还需 ffmpeg/ffprobe，以及 Playwright Chromium 或本机 Chrome。

```bash
pnpm --dir front run lint:check
pnpm --dir front run test:unit
pnpm --dir front run typecheck
pnpm --dir front run test:browser
```

`lint` 保留未过滤的原始输出。`lint:check` 只允许 `front/eslint-baseline.json` 中已知的存量问题，新增问题、解析错误及工具错误均失败；修复旧问题后运行 `pnpm --dir front run lint:baseline` 收缩豁免。维护命令不能接纳新问题；源代码行发生变化后仍存在的诊断也需要解决，不靠行号维持旧豁免。首次基线包含 181 个错误、117 个警告，不表示这些问题已经修复。

`test:workbench-ui` 还登记了 `unit-design` 和 `instruction-preparation`：验证 AI 明确应用后未保存卡片、保存失败恢复、当前编辑投影，以及顶部准备清单的定位和独立生成门禁。

`test:unit` 运行全部纯逻辑及公开 CLI 回归。`test:browser` 先调用现有 preflight，再运行清单中的用例；清单是文件、端口与超时的唯一登记处。所有用例串行执行，启动前检查声明端口，端口占用时停止且不终止占用者。端口检查不是系统级端口预留；请勿另外并行启动使用相同端口的脚本。

```bash
pnpm --dir front run test:workbench-ui
pnpm --dir front run test:canvas-graph
pnpm --dir front run test:design-scope
pnpm --dir front run test:browser management-ui
pnpm --dir front run test:browser home-project-layout
pnpm --dir front run test:browser lab-ui
pnpm --dir front run test:browser -- graph-summary
pnpm --dir front run test:browser -- --list
```

使用本机 Chrome 时设置 `PLAYWRIGHT_CHANNEL=chrome`；CI 安装 Chromium。入口可从其他工作目录调用，内部统一使用前端目录。默认证据位于 `front/test-results/browser-*`；可传 `--output <新的空目录>`。每个用例保留 `run.log`、真实后端的 `backend.log` 和截图，根目录 `results.json` 记录通过／失败、时长与路径。成功只输出摘要；失败打印有限日志尾部并保留完整日志。超时和中断会请求清理浏览器／服务／后端，POSIX 环境还对自己创建的进程组执行兜底终止。

`management-ui` 验证供应商、模型、运行设置、资产库、提示词模板、文件和 Agent 管理。`home-project-layout` 验证普通页面共享导航、管理入口、首页、项目、实验室及独立画布的外观隔离。两组使用隔离 HTTP 夹具，覆盖两种雾蓝主题和桌面、窄屏交互。界面验收范围见[管理页面前端规范](../../docs/development/standards/management-ui.md#验收)。

`lab-ui` 在真实页面上使用隔离 HTTP 和 SSE，覆盖会话导航与两种主题的视口矩阵、模板与参考配置、结果预览、提交恢复、草稿确认和运行中的文本停止。组合场景核对模板变量与素材一起提交、模型冲突修正、失败后继续编辑及返回会话读取结果。图片、视频使用本地测试媒体，包含主体参考视频的重载和播放检查。缩小视口、浏览器触屏模拟和组合输入事件用于检验前端行为，实体软键盘和真实供应商链路仍需单独验收。界面要求见[实验室前端规范](../../docs/development/standards/experiment-lab-ui.md#验收)。

`--manifest <文件>` 可使用同一 CLI 运行明确声明的本地清单；相对文件路径从清单目录解析，清单需包含 preflight、cases 和 suites。公开命令回归使用隔离清单验证成功、失败、超时、中断和端口占用，不启动真实模型。直接运行原 `.browser.mjs` 文件仍可用，但不会获得统一入口的预检／端口保护；没有指定统一证据目录时仍使用原有临时目录。

`sceneBrowseControls.browser.mjs` 通过真实选择器、导航按钮和卡片编辑覆盖四画布布局、明确对象传递、概览退出单元操作、紧凑横条与收起偏好、面包屑不占视口、底部状态的范围／零值／窄屏排布、失效目标及预览失败恢复；服务端图地址改名，避免依赖地址前缀。

新增或迁移用例时复用 `browser-runtime.mjs` 的证据目录、后端日志与幂等清理。graph 地址异常夹具复用 `canvas-graph-fixtures.mjs`：同时改名节点／边／视图和所有引用，保留 object、record、shot、unit 业务身份；跨画布来源只映射当前快照。长文本、多参考、历史重复行与并发读取继续由真实旅程／HTTP 回归验证。

`.github/workflows/frontend-checks.yml` 在相关 PR 与 merge queue 运行 lint 基线、纯逻辑、typecheck 和清单中注册的浏览器套件，并上传截图／JSON／日志。后端既有 pytest、Pylint CI 继续独立执行。本地通过不等同于 GitHub runner 已执行。

浏览器回归需要 Node.js 20+、Playwright 及 Chromium；`workspaceUsage.browser.mjs` 与 `workspaceCut.browser.mjs` 还需 ffmpeg。可复用 Codex workspace runtime；如果 Playwright 不在项目模块路径，通过 `NODE_PATH` 指向提供该包的 `node_modules`，并使用该 runtime 的 Node.js。

章节列表与编辑器使用 `node front/tests/chapterListEditor.browser.mjs`（默认 4205 端口），覆盖 105 章分页/搜索、表格滚动恢复、无跨章节汇总、未知数量、名称/精简/原文/对比/AI 优化后保存、影响确认、错误恢复、创建序号、归属校验和四尺寸截图。`node front/tests/chapterSequenceNavigation.browser.mjs`（默认 4201 端口）覆盖单层场次抽屉、默认详情、基本信息保存与手动选区、草稿保护、深链接、阶段往返、迟到响应及窄屏返回列表。两者拦截全部业务接口，不执行真实模型请求。当前章节契约见[章节划分架构](../../docs/development/architecture/chapter-division.md)。

`node front/tests/chapterSourceSelection.browser.mjs`（默认 4207，可用 `SOURCE_SELECTION_PORT` 修改）覆盖五列表格与直接划场、默认场次、改名保留旧来源、真实鼠标框选、跨 DOM 节点及 Unicode/CRLF 范围、重复匹配、重叠/版本冲突、AI 候选逐场确认、未保存保护、返回焦点、长原文位置恢复和四尺寸布局。`node --test front/tests/sourceSelection.test.mjs` 补充反向范围、空白、越界与半个代理对的异常输入。章节划分与并发保存边界见[章节划分架构](../../docs/development/architecture/chapter-division.md)。

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

测试替身证明前端交互与请求边界。采用指针、不可变版本和事务规则由 `backend/tests/directing/test_store.py`、`test_continuity.py`、`test_feedback.py` 的现有业务测试验证；没有后端变化时复用已有结果。迟到建议的服务端独立派生由 `backend/tests/directing/test_workspace.py` 验证。A17 的场景矩阵由前四组综合覆盖；A18 为 Chromium CSS 视口检查，不宣称真实手机硬件或全部浏览器通过。这些脚本不证明真实模型艺术质量或目标用户理解。A19 五秒用户测试已由用户明确取消，不再作为本次 UX5 门槛。

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

当前四画布投影、导航和保存的回归范围见[共享画布接入指南](../../docs/development/guides/canvas-graph.md#验证与接口同步)。

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

浏览器命令沿用上文 Playwright `NODE_PATH` 配置，各自启动4192/4193端口。测试结果和截图输出到独立临时目录。`workspaceDesignViews`另覆盖1/12/60/200镜头、表格/分镜滚动与版本隔离；`workspaceCut`核对精确片段、筛选、缩放及时间线重载恢复。


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

### E阶段资产与试拍衔接

沿用上述Node.js 20+和Playwright环境，运行：

```bash
node front/tests/workspaceShootStart.browser.mjs
node front/tests/workspaceAssetFlow.browser.mjs
node front/tests/workspaceShootSteps.browser.mjs
```

三个脚本分别监听4196–4198端口，所有业务接口由隔离替身处理，不修改真实项目或调用模型。起步回归检查设计状态、精确计划匹配、显式镜头选择、刷新和草稿往返；资产回归检查类型选择、创建结果不明的同身份重试、详情只读、编辑返回保护及确认版本派生；步骤回归检查统一选图、同主体多图和来源、模型能力失败重试、模型切换不丢图、素材读取失败恢复、关闭后的上传迟到保护、保存成功但确认失败后的重试，以及三步骤切换。均覆盖1440/1024/768/375宽度并输出独立截图目录。`node --test front/tests/referenceInput.test.mjs`验证分组、历史默认值、摘要及能力冲突；真实后端资产身份及媒体判定由`backend/tests/directing/test_store.py`、`test_production.py`和`test_visual.py`补充验证。


### 拍摄指令与检查结果可读化

`node --test front/tests/readableText.test.mjs` 验证固定快照名称、字段与枚举、主体组、同名对象、镜头与单元顺序、完整合法 ID 边界、数字／普通词保护、缺失降级、字段路径以及重复编译摘录的原文坐标。

`workspaceShootProgress.browser.mjs` 还覆盖易读／原文切换及两种复制、名称详情与焦点返回、历史预览隔离、单条检查原始数据、检查回跳与重复片段高亮、无映射提示、只读操作不写入、375px 名称详情；原有检查与试拍流程、四尺寸回归继续保留。沿用上文 Playwright 环境，所有业务接口均为隔离替身，不调用真实视频模型。

### 检查问题方向与 AI 修订

`node --test front/tests/reviewRevision.test.mjs front/tests/workspacePreparation.test.mjs` 验证逐项身份、同源检查保存后的方向延续、版本隔离、空方向、过期输入及草稿存储。

`node front/tests/workspaceReviewRevision.browser.mjs` 沿用上述 Playwright 环境并监听 4197 端口，不能与占用该端口的资产回归同时运行。使用隔离接口验证方向刷新恢复、空方向生成、迟到方案禁止采用、明确声音选择、真实前后预览、固定编辑区与单次建议消费、采用中断和响应丢失后同身份继续、新检查衔接及 1440／1024／768／375px 控件与边界。结果及截图保存在输出的临时目录，不调用真实模型。

后端 `tests/directing/test_review_revision.py` 负责真实契约、数据库版本隔离、声音选择、错误建议、并发与分步恢复，接口替身不能代替这些验证。

### 指令全生命周期

`node front/tests/workspaceInstructionLifecycle.browser.mjs` 使用 4196 端口及隔离数据，覆盖默认结构化正文、固定编辑区和检查侧栏、未检查主动修改、结果不抢占面板、人工字段直接预览、采用复检、跨计划历史、通过后修改与无变化不采用。四尺寸默认页面截图与请求记录写入测试输出目录。

`reviewRevision.test.mjs` 同时覆盖人工字段原值和单位换算、精确字段映射、已保存产物对应的恢复动作。`workspaceReviewRevision.browser.mjs` 验证在固定主区修改方向、声音选择及更新方案。浏览器替身只验证交互和请求契约；真实预览不写版本、候选身份和采用一致性由后端 directing 测试验证。

### 章节场次入口与连续划场

`node --test front/tests/chapterNavigation.test.mjs` 验证来源核对优先、阶段恢复、整场计数建议入口和规范路由。

`node front/tests/chapterSequenceNavigation.browser.mjs` 沿用上述 Playwright 环境，默认监听 4201，可用 `CHAPTER_NAV_PORT` 指定空闲端口。隔离接口验证详情按需加载、名称与顺序保存留页、未保存关闭及后退跨章保护、冲突保留输入、连续划场、旧链接面板定位、概览与原文读取恢复、过期建议只读，以及长列表返回恢复。1440／1024／768／375 宽度下检查标题键盘入口、页面与抽屉宽度及保存按钮命中；版本弹窗和试拍图由下述专项覆盖。

### 工作台统一版本

`node --test front/tests/workspaceVersions.test.mjs` 验证待选设计／计划／剪辑关联、空选择、失效与跨场身份。`node front/tests/workspaceVersions.browser.mjs` 使用 4202 端口和隔离接口，验证取消不生效、计划固定设计联动、剪辑独立、历史内嵌比较、创建及派生信息、预演时长说明，以及浏览不发业务写请求。覆盖保存失败保持原上下文、保存派生后应用待选对象、失效身份修复、四尺寸与键盘选项／Escape／焦点返回。AI 修订后依据同步由 `workspaceReviewRevision.browser.mjs` 覆盖。

### 试拍关系图

`node --test front/tests/productionGraph.test.mjs` 验证历史计划身份、多分支依赖与缺失来源、一单元多镜头、参考独立性、多指令候选归属和当前草稿不能替代固定指令依据。`node front/tests/workspaceProductionGraph.browser.mjs` 使用 4203 端口与隔离接口，验证输入节点复用详情表单、历史单元只读、候选回跳、四种宽度及浏览零写入。图形组件使用 `ProductionRelationGraph.tsx`，避免与纯规则 `productionGraph.ts` 在大小写不敏感文件系统上冲突。保存／确认、参考及模型变更由 `workspaceShootSteps.browser.mjs` 覆盖；固定指令恢复由 `workspaceShootContext.browser.mjs` 覆盖；验证图、批量拍摄和重组由 `workspaceProduction.browser.mjs` 覆盖。这些隔离回归不证明真实供应商可用性或生成内容质量。


### 工作台五层框架与试拍布局统一

`node front/tests/workspaceLayout.browser.mjs` 使用 4214 端口、上述 Playwright 环境及 ffmpeg 合成媒体，在 1440／1280／1024／768／375px 检查三个阶段的场次栏、阶段栏、内部导航与内容边界、剪辑播放器和时间线共存、无横向溢出，保存 15 张实际页面截图和几何数据。另验证步骤独立滚动、阶段返回、前进后退、刷新、旧滚动记录恢复、窄屏辅助抽屉焦点返回以及零业务写入。

`workspaceShootSteps.browser.mjs` 在上述五宽度逐步比较单元标题、主操作、步骤栏、内容起点及桌面 344px 辅助栏；`workspaceShootFlow.browser.mjs` 验证预览打开后候选网格宽度不变。`workspaceCompactReview.browser.mjs` 验证窄屏检查抽屉处理后关闭，再阅读完整指令；主操作断言位于统一标题栏。共享滚动存储以 `positions[identity]` 保留多个对象／视图位置，剪辑回归继续验证刷新后的实际位置。

旧布局验收记录已随历史计划清理；本节列出的脚本范围不代表当前工作树已重新执行。接口替身不验证真实供应商、模型生成质量或全部浏览器。

### 单元指令内容区（实施中）

`node --test front/tests/instructionContent.test.mjs front/tests/reviewRevision.test.mjs` 覆盖固定正文全量保留、背景与执行边界、重复和重叠映射、字段归属、路径层级匹配、局部范围存储及损坏范围阻止提交。`node front/tests/workspaceInstructionContent.browser.mjs` 使用 4216 端口，验证真实分块正文、从摄影卡片选择范围、刷新恢复、提交精确 scope、切回整体范围保留输入、原文切换、四尺寸和零采用／拍摄写入。运行环境沿用上文 Codex Node.js / Playwright。专项还覆盖关联图节点查看、真实候选与过期草稿分离、图视图刷新恢复、返回正文焦点、1920px 三列及窄屏纵向布局；检查问题定位由 compact-review 回归验证。图只读关系的证据约束由 instructionContent 单元测试验证，包括无正文决定、固定单元参数和跨检查来源隔离。浏览器专项验证超过三项的展开／收起、键盘选择节点和内容、来源直接编辑、生成中编辑与迟到候选不抢焦点；compact-review 覆盖多处正文定位、精确片段高亮及历史关联图只读。

### 默认资产与单元身份参考

`pnpm --dir front run test:browser -- references` 通过真实导演／单元画布、独立 HTTP 后端、数据库和对象存储验证默认候选解耦与身份参考来源。`reference-source`（4258／8258）验证明确更换来源、整组应用／取消、逐图跨源拒绝、非目标输入及单元隔离；模型请求不调用付费服务。

### 生成画布综合验收

`node front/tests/run-browser.mjs generation-canvas-acceptance` 使用4283/8283、真实HTTP/TaskWorker与受控图片供应商/对象存储，检查1440/375宽度下的媒体解码与视口边界、长正文保留、底部参数键盘焦点和独立画布入口。截图使用保存的可读缩放布局，按媒体/长文/参数分别核查卡内滚动；不将截图存在视为视觉验收。

`backend/tests/test_generation_canvas_journey.py` 使用显式 `JELLYFISH_TEST_MYSQL_URL` 的隔离MySQL库，依次真实生成文本、图片、视频，前一成果完成后才创建下一引用，并比对预检与真实供应商payload；无真实模型费用。

应用壳的项目/资产/三类实验室交互通过注册用例运行：`PLAYWRIGHT_CHANNEL=chrome node front/tests/run-browser.mjs legacy-labs`（4184端口）。该入口明确设置`SHELL_INTERACTIONS_ONLY=1 SHELL_LAB_REGRESSION_ONLY=1`，默认完整壳脚本的原断言仍保持启用。此范围明确不含末段旧场次壳断言；当前场次工作台使用统一runner的`canvas-graph`单独回归。完整规格证据与实际限制见`.scratch/generation-canvas/acceptance.md`。

`generation-canvas-guidance` 验证创作控制、生成指导、验收要求的真实编辑，拖拽建立验收候选、三类使用方明确关联及取消、只读采用记录、完整标准的模型直接采用、保存重开和窄屏。测试只替换供应商与媒体存储边界。

## Four-card versioned visual evidence

The confirmed C target is retained at `front/tests/visual-baselines/c-794ee4a0-v1/manifest.json` with original PNGs, SHA-256 identities, source revision, capture boundaries, applicable review regions and `contract.md`. The 36 combinations are F01–F12 at 1440×960, 390×844 and 3830×1688, zoom 1. Target mobile cards are explicitly absent in the prototype; actual mobile card evidence is still required. The contract records text overrides of prototype defects and placeholders. An update requires an explicitly reviewed new version directory and a reason; keep the previous version. This CLI never accepts actual screenshots as new targets.

Use the existing runner to capture current behavior and evidence (Node 24 and the configured Playwright browser):

```bash
C60_PROTOTYPE_MANIFEST="$PWD/front/tests/visual-baselines/c-794ee4a0-v1/manifest.json" \
  pnpm --dir front run test:browser generation-canvas-four-card-acceptance
```

Use the suite id from `browser-suites.json` if selecting by another supported alias. The runner's existing output/archive directory contains `matrix.json`, page/card/editor originals, `visual-states.json` (capture-time public HTTP card/output state, zoom/viewport and image identity), `visual-run.json` (actual source/fixture revision, fixture content hashes, dirty-worktree information and environment), `visual-result.json` and `visual-index.md`. Images retain original dimensions. The index links individual originals; per-group real model parameters, adopted structured references, output identity and material differences appear in the result. Card crops include external titles; retained prototype body crops are supplemented with title crops for desktop default/empty states.

Recheck an archived run without starting the app or executing a model:

```bash
node front/scripts/visual-evidence.mjs \
  --manifest front/tests/visual-baselines/c-794ee4a0-v1/manifest.json \
  --matrix /path/to/evidence/matrix.json \
  --run /path/to/evidence/visual-run.json \
  --output /path/to/evidence/visual-result.json
```

The three conclusions are independent: `behavior.status` is `passed`/`failed`; `evidence.status` is `reviewable`, `failed` or `not-checked`; `visual.status` remains `not-reviewed`. Missing/mismatched groups, versions, state, images or original identities fail with the affected combination and reason. `reviewable` proves mechanical completeness, never visual agreement. Matrix-embedded legacy `target` fields are ignored; the supplied versioned manifest is authoritative. Actual image paths resolve against the matrix directory; target paths are relative to the versioned manifest. Result image entries include `relativePath` relative to the output file for archived actual evidence; the repository retains target originals. Rerun the CLI after relocating an archive to refresh absolute convenience links.

An ordinary run without `C60_PROTOTYPE_MANIFEST` can pass its behavior assertions while reporting evidence `not-checked` and visual `not-reviewed`. The same explicit classification can be inspected independently with `node front/scripts/visual-evidence.mjs --behavior passed`. CLI failure exits nonzero, including a failed behavior result; a successful evidence check cannot promote visual status. Human signoff must bind reviewed image and contract content identities separately.

Public CLI regression: `node --test front/tests/visualEvidence.test.mjs`. Controlled fixtures used there are deliberately synthetic evidence tests, not product acceptance or human review records.

### Human visual review and invalidation

Prepare a review against the current authoritative baseline and current original files:

```bash
node front/scripts/visual-review.mjs \
  --manifest front/tests/visual-baselines/c-794ee4a0-v1/manifest.json \
  --matrix /path/to/run/matrix.json --run /path/to/run/visual-run.json \
  --output /path/to/run/review-prepared.json
```

This exits 1 with visual `not-reviewed` and a `reviewTemplate`; preparation never approves images. Copy `reviewTemplate` to a separate JSON review file. Supply `reviewer`, `reviewedAt` and the source result path. Actually open the target and actual originals (whole page, editor and titled card), then fill each applicable region with `status` (`passed`, `difference`, `unverified`), a concrete `observation`, and `allowedDifferences: [{difference, basis}]` when a documented contract permits a difference. Leave uninspected groups explicitly `unverified` with that observation. Required regions and their detailed visual criteria come from the versioned contract, including the mobile target omission rules. Static images alone cannot prove keyboard behavior: cite retained real-page behavioral evidence where appropriate and keep uncertainty unverified.

Repeat the command with `--review /path/to/review.json --output /path/to/review-result.json`. The CLI rechecks the authoritative manifest, contract, capture state and actual image bytes through the evidence verifier; a saved result claiming `passed` is never accepted as authority. Review schema v1 binds baseline version, contract and manifest hashes, group keys, original target/actual image hashes, capture hashes and exact applicable regions. Missing/duplicate entries, invalid identity, missing reviewer/time/observation or an unexplained allowed difference cannot pass. Valid records with differences or unverified regions report `incomplete`. Exit zero requires behavior passed, current evidence reviewable and every required region explicitly passed. This validates a review declaration; it cannot prove the reviewer actually viewed the images.

Content changes to the contract, target or actual originals invalidate prior signoff. Source commit/run identity or descriptive manifest metadata alone may be reused with explicit `--reuse-review` only when the current baseline version, contract, original images, capture state and regions still match. The output retains original and current identities in `visual.reuse` and does not claim new capture or new review. Relocated paths alone do not change content identity. Preserve the review JSON and result with the original evidence archive. CI continues to report its independent unreviewed status; it does not generate signed reviews.

Public regressions: `node --test front/tests/visualReview.test.mjs front/tests/visualEvidence.test.mjs`. Their controlled review declarations test CLI validation only and are never product visual signoffs.

CI supplies the retained manifest explicitly to the existing browser runner and reruns the public evidence verifier against its fixed `front/test-results/ci-browser/generation-canvas-four-card-acceptance` output. The browser job still depends on the lint/unit/typecheck job and propagates every nonzero exit. Its always-run artifact upload includes the complete target directory and browser output, including original actual PNGs, JSON identities, Markdown comparison index, logs and any externally completed review files present there. CI does not create visual approval; a fresh run remains `not-reviewed` until originals receive an explicit review.

### 生成画布交互

`PLAYWRIGHT_CHANNEL=chrome node front/tests/run-browser.mjs canvas-interaction` 覆盖生成画布拖动与编辑器锚定、多选、边缘自动平移、Escape、键盘移动和统一历史、滚轮缩放、输入／菜单隔离、整批删除引用保护、桌面及窄屏编辑器，并回归图片完整展示和既有卡片／编组流程。`generation-canvas-interaction` 可单独运行新交互用例；截图与日志保存在 runner 输出目录。

完整生成画布布局回归使用 `PLAYWRIGHT_CHANNEL=chrome node front/tests/run-browser.mjs canvas-layout`。当前锚定模型编辑器高度为 320px；桌面模型、参考和描述编辑器按无标题／无关闭按钮的约定验收，基础内容保留标题及关闭入口；小于 1280px 时所有编辑器提供一步关闭，不显示展开／收起。关闭辅助器逐层执行真实按钮或 Escape，并等待隐藏及解除 inert；展开辅助器验证真实展开状态。窄屏截图准备通过公开缩放和键盘布局控件容纳 360px 模型卡，截图不替代来源、草稿、媒体选择及控件命中检查。


九项交互规则的正式回归由 `generation-canvas-interaction` 与 `generation-canvas-interaction-rules` 共同覆盖，均包含在 `canvas-interaction` 和 `canvas-layout`。新增规则用例使用真实页面、公开 HTTP 及隔离 SQLite／媒体夹具；只在系统边界模拟供应商响应。窗口失焦和 IME 使用浏览器事件，指针捕获丢失通过浏览器 API 触发，触摸取消使用 Chrome 真实触摸输入；不代表已覆盖所有实体设备。

| 规则 | 正式验收入口与关键断言 |
| --- | --- |
| Q1 编辑器空间 | rules 的五种初始布局验证桌面始终下方左对齐、空间不足只平移视口／不改卡片坐标，窄屏保持模态；缩放保持字号。editor-reveal 验证动画、打断、手动出屏、草稿、窗口缩放及收回展开态。interaction 验证拖动保持相对间距。 |
| Q2 边缘平移 | rules 验证悬停不触发、接近边缘加速、卡片保持指针锚点、编辑器同步、离开边缘／松手停止；interaction 验证 Escape 恢复卡片与原视口。 |
| Q3 多选拖动 | interaction 验证整体平移及一次撤销／重做；rules 验证拖动未选卡切换为单选，不移动其他卡、不打开编辑器。cards／sessions 回归草稿与媒体会话保持。 |
| Q4 删除 | interaction 验证引用保护整批拒绝；rules 验证堆叠、运行保护、确认期间状态变化后的重新检查、统一确认与取消，一次撤销恢复卡片／相关连线／输入顺序／分组／位置，上传及实际生成文件仍可下载。 |
| Q5 选择与导航 | interaction 验证复杂导演卡 Enter／Space 激活；rules 验证 Shift 框选追加、框选取消与中键平移；interaction／cards 验证修饰键选择、Space 拖动及输入隔离。 |
| Q6 缩放与移动 | rules 验证滚轮指针中心、加减键视口中心、0 适应全部、空白方向键平移、Shift 步长 50；interaction 验证普通步长 10、拖动滚轮冻结；rules 同时验证拖动期间 0 不缩放。 |
| Q7 逐层 Escape | rules 验证展开→锚定→关闭编辑器→取消选择、收回展开态时回下方并必要让位、框选与删除确认取消；interaction／accessible-connections／common-shell 保留手势、菜单、连线与内层选择器覆盖。 |
| Q8 中断 | rules 验证失焦、捕获丢失和真实触摸取消保留最后位置、结束拖动且一次可撤销；阈值内触摸中断不移动、不打开编辑器。 |
| Q9 撤销与隔离 | rules 验证文字原生撤销不消耗移动历史、内容与布局按时间顺序撤销／重做、长按方向键合并、Ctrl＋Y、IME／弹窗隔离；interaction 验证菜单删除键及编辑器滚轮隔离。普通浏览改变视口，不进入画布历史。 |

规则用例输出 `rules.json`、定位截图和失败截图；失败立即终止，不以截图或用例总数代替行为断言。

组合优先级回归：`generation-canvas-interaction-combinations`（包含在 `canvas-layout` / `canvas-interaction`）覆盖拖动混用方向键／撤销／缩放、最终位置重做、菜单关闭与 Escape、多选 Enter／Space、拖动中导演卡激活、组合输入信号和 Space 配对／中断。组合输入使用浏览器事件信号验证，不代替实体输入法测试。

组合规则逐项验收（`generation-canvas-interaction-combinations`）：

| 补充规则 | 验收内容 |
| --- | --- |
| S1 拖动独占 | 拖动混用方向键、Enter、Space、撤销／重做及 0；最终释放位置可一次撤销／重做。 |
| S2 起拖关闭菜单 | 阈值内按下保留菜单，起拖关闭当前或其他卡菜单，Escape 恢复原位置。 |
| S3 多选键盘一致 | Enter／Space 切换相同选择，不打开编辑器；多选 Space 拖动只平移视口且保留选择；普通菜单按钮仍可键盘激活。 |
| S4 输入与 Space 隔离 | 连续按住 Space 多次平移；焦点切换、进入输入区、失焦和 Escape 取消待执行激活；视口、编辑器及独立键盘入口隔离组合输入信号。 |

Q7／Q9 组合验收同时检查：菜单打开后的方向键、删除、缩放及历史命令隔离，空白焦点 Escape 关闭菜单并恢复焦点，筛选下拉先关闭再关闭旧卡菜单。编组手柄另验方向键松开不截断指针事务、失焦保留位置且不续拖，一次撤销／重做恢复最终结果。单个入口通过不代表其他入口已覆盖；IME 用例仅验证浏览器组合输入事件信号。

Q7 叠层场景另覆盖四条直接回归：连线＋布局菜单、连线＋卡片菜单、模型候选面板＋较旧布局菜单、模型候选面板＋较旧卡片菜单。断言处理层关闭且外层状态保留，再连续 Escape 退出外层；同时验证原生选择器先于候选面板关闭、组合输入 Escape 不推进层级、焦点离开菜单后仍先关菜单，以及删除确认取消不取消后台连线。候选打开后将焦点移到模型正文或画布、编辑器展开再收起，仍先关闭候选并保留较旧菜单。

UX 回归另覆盖画布局部键盘焦点提示与方向键平移、输入后点击画布不出现外框或键盘提示、卡片选中及焦点描边不包含外置标题、390／1024px 触摸关闭入口的 44×44px 热区和中心命中，以及桌面展开后切到窄屏的一步关闭／Escape、模型草稿保留、焦点约束、候选优先退出与回到桌面的入口恢复。

`generation-canvas-editor-reveal` 覆盖固定下方的新打开生命周期：150ms动画及关闭保留视口、减少动态效果、重复打开／编辑不重定位、草稿重开、手动平移与缩放及卡片出屏后仍跟随、指针／滚轮／导航键／组合输入信号打断不续播、窗口缩小让位而放大保留、主动展开收回、取消拖动与撤销保留此前让位、取消临时连线恢复编辑器不二次让位。另覆盖参考卡与文本模型在普通动画／减少动态效果下的“压缩→关闭→放大窗口→移卡→重开”：验证按恢复后的最终高度让位、16px跟随、世界坐标不变及文本模型预检入口实际可点击。该用例属于 `canvas-interaction` 和 `canvas-layout`；动画观察真实帧上的视口位置，不模拟内部布局函数。

### 参考卡名称引用

`generation-canvas-reference-mentions` 纳入 `generation` 和 `canvas-layout`，使用真实画布、公开 HTTP、隔离数据库及媒体夹具。候选异步重排／不可用仅在 HTTP 响应边界控制；组合输入使用浏览器事件，不替代实体输入法验收。

| 确认规则 | 正式回归 |
| --- | --- |
| 1. 四类参考卡名称；其他来源沿用编号 | 人物、场所、道具、服装及普通图片；视频用途，原文本模型套件保持文本能力边界 |
| 2. 展示与提交分离，历史冻结 | 预检名称→image N、原 token/source/media_position；运行后改名，历史 basis 与输入保持原值 |
| 3. 改名／清空同步 | 实际名称控件编辑、清空，已有 chip 与绑定核对 |
| 4. 候选确认才绑定名称 | 名称普通文本、含编号名称完整／连续输入／跨节点粘贴、未在候选中的限定名称、候选点击／回车；独立编号确认 |
| 5. 不因标签改动重新编号／绑定 | 混合来源原编号、改名前后 binding 完全相同 |
| 6. 当前模型关联范围 | 无关卡不参与、未采用同名卡及暂不可用来源参与；两个真实画布同 ID 引用复制粘贴不借用本地名称／消歧，保留外来身份诊断 |
| 7. 同名组统一三级消歧 | 不同角度、跨类型同角度、同类型同角度原编号后缀；名称含消歧文本 |
| 8. 编号式名称保留限定 | 与实际编号重叠及精确编号优先（含裸编号粘贴和尾随空格） |
| 9. 冲突出现同步刷新 | 改名产生同名，已有引用限定更新 |
| 10. 冲突消失恢复最短名称 | 实际改名解除冲突、清空回退原编号 |
| 11. 候选身份与组合输入 | 重排保留高亮、失配／失效清空、回车消费、方向键重新选择；IME 延后更新、光标／文档修订保持 |

名称引用专项另覆盖 255 字名称：候选行限制宽度并保留完整可访问名称／提示，正文 chip 可换行，避免撑破候选弹层和编辑框。

名称引用修复回归同时检查桌面与窄屏的同名长名称缩略入口：实际悬停后读取完整限定提示、确认标签确已截断、保留普通媒体提示，并验证展示操作不增加画布文档修订。跨画布用例清理外来引用后再采用本地来源，并保存重开验证身份。

### 运行历史刷新

`generation-canvas-history-refresh` 使用一个真实运行验证任务深链接首次定位；关闭按钮、顶部开关、Escape、窄屏关闭或切换到卡片详情后刷新均保持关闭，只清理 `run/node` 并保留其他地址参数。另验证手动重新打开、后退不回到已关闭的定位地址，以及刷新不重新生成。纳入 `generation` 和 `canvas-layout`。


### 生成画布右键菜单

`generation-canvas-context-menu` 使用隔离 HTTP/DB/TaskWorker 与真实画布，覆盖右键创建、复制后手动粘贴、副本配置、候选连线不复制、真实引用保护、跨画布及刷新剪贴板、统一撤销重做、编辑区右键屏蔽、键盘菜单与逐层取消、图片封面持久化及原卡删除后的文件保护、单文本下载与多图片ZIP。入口已加入 `generation` 和 `canvas-layout`，证据包含菜单截图及后端日志。

堆叠与编组的真实指针多选使用宿主平台的 Command／Control；不通过伪造 `navigator.platform` 在 macOS 上发送 Control+点击，避免原生右键手势与多选测试混淆。

右键专项同时覆盖连续右键切换后的首次操作、编组／堆叠焦点的菜单及复制粘贴快捷键隔离、媒体校验延迟期间平移和缩放后的最新视口落点，以及 generated client 二进制下载失败后保留选择并重试。

附件下载另以独立后端 origin 验证 CORS 响应头暴露及 generated client 的真实 PNG 字节，防止仅同源代理通过。

右键菜单的七条视觉与多级规则由同一专项覆盖：首次帧尺寸和无溢出、单行禁用背景、三级目录与图标文字完整显示、父菜单锚点稳定、左右边缘及短屏独立避让／滚动、指针跨越、逐层Escape与Tab、窄屏单浮层返回、44px触屏热区、各级滚动与焦点恢复。左侧搜索继续由原添加面板用例覆盖，右键菜单不嵌入搜索框。

`generation-canvas-layout-convergence` 用真实场所参考卡与图片模型卡，连续 40 轮中键平移、交替缩放和移动撤销／重做，每四轮重载，覆盖布局同步无变化时的收敛与浏览视角保留；登记在 `canvas-layout` 套件。该场景曾捕获 `useGraphLayout` 无变化仍派发更新导致的 `Maximum update depth exceeded`。

`canvas-design` 覆盖画面设计 A 方案：类型专属卡面、常驻编辑入口、固定摘要优先级与特殊状态／运镜阶段、长摘要键盘全文、参数／关联与摄影分区切换、预设预览／覆盖清单／一次撤销、关闭会话清理、只读预览和桌面／窄屏固定操作区。运行 `PLAYWRIGHT_CHANNEL=chrome node front/tests/run-browser.mjs canvas-design --output /tmp/jellyfish-canvas-design`；仍使用隔离后端与真实画布页面，不使用视觉原型替代业务验收。原型对比保存在 `codex-prototype-design-cards` 分支（`da20a493`），生产路由已移除原型入口。

`generation-canvas-design-editor` 补充画面设计编辑器四项交互规则：悬停不展开／无业务写入、点击菜单正确锚定且静止后不持续定位、Escape／Tab／字段／遮罩取消优先级、统一元信息开关的会话保留及关闭重置、特殊状态与已填写数量、输入不重新居中、桌面和短窄屏自适应高度及只读保护。该用例登记在 `canvas-design`，与原有卡面、预设覆盖撤销和摄影采用范围回归一起运行。


表演与调度七类的共享卡面、预设／高级设置、字段引用及素材携带使用 `PLAYWRIGHT_CHANNEL=chrome pnpm --dir front run test:browser performance-design` 验收。套件包含原表演／空间流程及七类预设、具名锚点、有效／停用引用、旧文字字面保护、保存重开、只读、桌面和窄屏回归；模型携带的冻结执行与异常输入另由后端公开接口／Worker 测试覆盖。

`generation-canvas-narrative` 覆盖叙事概览、节拍、事件与镜头的共享预设应用及重开恢复、字段引用、关系与覆盖节拍排序、镜头画面目标、只读及桌面／390px 布局。

`sound-constraint` 覆盖声音与连续性约束八类共享入口、预设、字段引用、对白版本、原有声音／证据／验收关系与390px布局。
