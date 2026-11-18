# 场次工作台体验回归

从项目根目录运行既有纯行为回归，使用现有 TypeScript 编译器与 Node.js 内置测试工具：

```bash
node --test front/tests/chapterNavigation.test.mjs front/tests/sourceSelection.test.mjs
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

`test:unit` 运行全部纯逻辑及公开 CLI 回归，也执行浏览器清单检查及其正反例。可从项目根目录单独运行 `node front/tests/check-browser-manifest.mjs`；`--manifest <文件>` 用于检查独立夹具，扫描范围为清单所在目录及子目录。

`browser-suites.json` 的 `cases` 登记文件、端口和超时，`suites` 的并集决定默认 `all` 执行范围。每个 `*.browser.mjs` 必须登记，或在 `excludedFiles` 按精确相对路径填写非空理由；已登记但不在任何套件中的用例，必须在 `nonDefaultCases` 按用例名说明原因。检查会拒绝失效引用、重复登记、登记与排除冲突、空理由及无说明的套件不可达。排除项不是通配模式，不提供自动刷新命令。

清单在 `excludedFiles` 和 `nonDefaultCases` 保留仍存在的未登记或套件不可达项，逐项记录尚未核验状态或已确认的承接缺口，不表示废弃或已被替代，也不据此扩大 CI 执行范围。新增文件应登记并接入适用套件；确需排除时必须人工说明具体理由。核验存量后应逐项接入或修订原因，移除失效豁免。

`generation-canvas-chrome-baseline` 是保留的导演工作台对照基准，可通过 `pnpm --dir front run test:browser generation-canvas-chrome-baseline` 单独运行。原 ToolsBaseline 除前后端端口外与它全文相同，重复脚本和登记已移除；历史验收记录仍保留当时使用的名称。

现有 CI 的 `test:unit` 阶段检查清单，通过后浏览器阶段运行默认 `all`；`workbench` 已包含 `chapter-list-editor` 和 `scene-canvas-legacy-routes`。无需新增 CI 作业或改变全局时间预算。

`test:browser` 先调用现有 preflight，再运行清单中的用例；清单是文件、端口与超时的唯一登记处。所有用例串行执行，启动前检查声明端口，端口占用时停止且不终止占用者。端口检查不是系统级端口预留；请勿另外并行启动使用相同端口的脚本。

```bash
pnpm --dir front run test:workbench-ui
pnpm --dir front run test:browser management-ui
pnpm --dir front run test:browser home-project-layout
pnpm --dir front run test:browser lab-ui
pnpm --dir front run test:browser -- --list
```

使用本机 Chrome 时设置 `PLAYWRIGHT_CHANNEL=chrome`；CI 安装 Chromium。入口可从其他工作目录调用，内部统一使用前端目录。默认证据位于 `front/test-results/browser-*`；可传 `--output <新的空目录>`。每个用例保留 `run.log`、真实后端的 `backend.log` 和截图，根目录 `results.json` 记录通过／失败、时长与路径。成功只输出摘要；失败打印有限日志尾部并保留完整日志。超时和中断会请求清理浏览器／服务／后端，POSIX 环境还对自己创建的进程组执行兜底终止。

`management-ui` 验证供应商、模型、运行设置、资产库及四类独立资产详情、提示词模板、文件和 Agent 管理。`home-project-layout` 验证普通页面共享导航、管理入口、首页、项目、实验室及独立画布的外观隔离。两组使用隔离 HTTP 夹具，覆盖两种雾蓝主题和桌面、窄屏交互。界面验收范围见[管理页面前端规范](../../docs/development/standards/management-ui.md#验收)。

`asset-detail` 可单独运行，覆盖四类档案的双栏／单栏、矮屏滚动、两种主题、键盘图片预览与焦点恢复，以及保存失败、部分成功重试、未保存离开、检测取消确认、生成终态恢复、历史采用和读取失败。所有业务响应在 HTTP 边界隔离，不调用供应商生成。

`lab-composer` 覆盖模型直接选择与搜索、添加菜单、统一发送、右侧素材摘要和按角色移除；与既有模板、上传、停止和草稿回归一起纳入 `lab-ui`。

`lab-ui` 在真实页面上使用隔离 HTTP 和 SSE，覆盖会话导航与两种主题的视口矩阵、模板与参考配置、结果预览、提交恢复、草稿确认和运行中的文本停止。组合场景核对模板变量与素材一起提交、模型冲突修正、失败后继续编辑及返回会话读取结果。图片、视频使用本地测试媒体，包含主体参考视频的重载和播放检查。缩小视口、浏览器触屏模拟和组合输入事件用于检验前端行为，实体软键盘和真实供应商链路仍需单独验收。界面要求见[实验室前端规范](../../docs/development/standards/experiment-lab-ui.md#验收)。

`--manifest <文件>` 可使用同一 CLI 运行明确声明的本地清单；相对文件路径从清单目录解析，清单需包含 preflight、cases 和 suites。公开命令回归使用隔离清单验证成功、失败、超时、中断和端口占用，不启动真实模型。直接运行原 `.browser.mjs` 文件仍可用，但不会获得统一入口的预检／端口保护；没有指定统一证据目录时仍使用原有临时目录。

新增或迁移用例时复用 `browser-runtime.mjs` 的证据目录、后端日志与幂等清理。graph 地址异常夹具复用 `canvas-graph-fixtures.mjs`：同时改名节点／边／视图和所有引用，保留 object、record、shot、unit 业务身份；跨画布来源只映射当前快照。长文本、多参考、历史重复行与并发读取继续由真实旅程／HTTP 回归验证。

`.github/workflows/frontend-checks.yml` 在相关 PR 与 merge queue 运行 lint 基线、纯逻辑、typecheck 和清单中注册的浏览器套件，并上传截图／JSON／日志。后端既有 pytest、Pylint CI 继续独立执行。本地通过不等同于 GitHub runner 已执行。

章节列表与编辑器使用 `pnpm --dir front run test:browser chapter-list-editor`（默认 4205 端口），通过隔离接口覆盖分页搜索、滚动恢复、未知场次数量、章节编辑、保存失败、创建及归属校验。工作台管理、划分和旧路由通过 `pnpm --dir front run test:browser workbench` 中的真实浏览器用例验证。`node --test front/tests/sourceSelection.test.mjs` 补充反向范围、空白、越界与半个代理对的异常输入。当前契约见[章节划分架构](../../docs/development/architecture/chapter-division.md)。

测试替身证明前端交互与请求边界。采用指针、不可变版本和事务规则由 `backend/tests/directing/test_store.py`、`test_continuity.py`、`test_feedback.py` 的现有业务测试验证；没有后端变化时复用已有结果。迟到建议的服务端独立派生由 `backend/tests/directing/test_workspace.py` 验证。浏览器回归仅声明实际执行的 Chromium CSS 视口检查，不代表真实手机硬件或全部浏览器。这些脚本不证明真实模型艺术质量或目标用户理解。A19 五秒用户测试已由用户明确取消，不再作为本次 UX5 门槛。

## 全站布局框架回归（A1–A3）

```bash
node --test front/tests/shellNavigation.test.mjs
node front/tests/shellAcceptance.browser.mjs
node front/tests/shellFocus.browser.mjs
```

`shellAcceptance.browser.mjs` 使用同样的 Node.js / Playwright 环境，临时监听 `127.0.0.1:4184`。接口请求由测试替身隔离，不连接真实服务或调用模型。默认截图与测量数据位于 `/tmp/jellyfish-shell-acceptance`，可通过 `SHELL_EVIDENCE_DIR` 指定输出目录。

覆盖全部路由族、项目与资产页签、五种规定尺寸、全局导航、真实标题回跳、任务抽屉、资产与 Agent 保存、实验室历史与固定输入区，以及现行入口参数恢复。

`shellFocus.browser.mjs` 临时监听 `127.0.0.1:4185`，验证桌面与手机导航的 Tab 往返、2px 可见焦点及 Escape 关闭；手机导航位于应用壳外的抽屉门户中，因此单独覆盖其焦点样式。

### 章节场次入口与连续划场

`node --test front/tests/chapterNavigation.test.mjs` 验证现行章节与场次管理导航。运行 `pnpm --dir front run test:browser workbench-management`、`workbench-division` 和 `scene-canvas-legacy-routes` 验证管理步骤、划分与历史、窄屏步骤导航与场次选择、现行管理入口、无画布身份的准备链接和保留的后端记录保护。`scene-storyboard-media` 从章节列表贯通划分、对象参考、后台分镜、画布编辑保存和明确单卡执行。

### 生成画布综合验收

`node front/tests/run-browser.mjs generation-canvas-acceptance` 使用4283/8283、真实HTTP/TaskWorker与受控图片供应商/对象存储，检查1440/375宽度下的媒体解码与视口边界、长正文保留、底部参数键盘焦点和独立画布入口。截图使用保存的可读缩放布局，按媒体/长文/参数分别核查卡内滚动；不将截图存在视为视觉验收。

`backend/tests/test_generation_canvas_journey.py` 使用显式 `JELLYFISH_TEST_MYSQL_URL` 的隔离MySQL库，依次真实生成文本、图片、视频，前一成果完成后才创建下一引用，并比对预检与真实供应商payload；无真实模型费用。

`PLAYWRIGHT_CHANNEL=chrome node front/tests/run-browser.mjs legacy-labs` 验证三个退役实验室地址显示 404。应用壳的项目、资产和实验室交互可从 `front` 目录运行 `PLAYWRIGHT_CHANNEL=chrome node tests/shellAcceptance.browser.mjs` 单独检查。现行场次画布与管理入口由 `independent-canvas` 和 `scene-canvas-legacy-routes` 覆盖，后者使用只有一条历史交付引用的文件验证删除保护。

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

工作台画布管理回归复用 `workbench-canvas-creation`、`workbench-canvas-cards`、`workbench-canvas-rename` 和 `workbench-storyboard-retry`：覆盖更多菜单中的空白创建、提交身份核实、未提交配置保护、候选采用与独立画布打开、失败恢复及更名。卡片用例同时核对双主题与桌面／矮屏／窄屏布局、长任务详情的底部操作和键盘关闭焦点；所有任务使用既有隔离后端，不验证真实供应商生成质量。

`project-files` 通过真实项目文件页面与隔离HTTP覆盖显式批量模式、退出清空、追加选择保留、筛选重置和迟到响应隔离、图片与有效本地音视频预览、键盘关闭焦点、真实单项／批量下载目标、读取失败重试及空列表。用例使用ffmpeg生成短音视频夹具，沿用既有媒体工具预检；同时检查两种雾蓝主题和四种视口的长名称与横向溢出，不连接真实生成供应商。

文件长列表性能：`PLAYWRIGHT_CHANNEL=chrome node tests/run-browser.mjs project-files-performance`。240／1200／5000条记录，1920×1080栅格图片；输出挂载卡片、加载耗时、强制GC后的JS堆和滚动帧间隔P95。JS堆不包含全部解码图片与进程内存，不作为浏览器总内存证明。基线对比可通过FILE_PERF_ROOT指定旧前端快照并设置BASELINE=1。

管理文件页由file-management回归覆盖六列、渐进检索96条上限／继续检索、筛选重置和刷新保护；managed-files-performance检查240／1200／5000条下的挂载数量及JS堆和帧间隔。与项目文件共享网格和箭头变更时同时运行project-files。JS堆不代表浏览器全部图片或进程内存，元信息仍随加载累积。

工作台管理布局与入口调整由 `workbench-management`、`workbench-canvas-cards`、`scene-object-preparation` 回归：216px步骤导航、正文场次切换与历史分组、组合筛选及保存后焦点、固定划分工具栏、默认封面与真实创建时间、画布名称进入与候选采用区分、列表搜索返回恢复、当前正文复用资产详情及未保存保护。`workbench-division`、`workbench-canvas-creation`、`workbench-storyboard-retry` 补查原有草稿、提交和恢复行为。浏览器使用隔离后端及受控供应商，不代表真实供应商生成质量已验收。

场次划分的 `workbench-division` 使用真实隔离后端与页面操作，覆盖右侧场次辅助区、旧顺序转原文顺序、键盘选区拆分／相邻合并、身份确认、保存离开、历史恢复、原文重新定位及窄屏抽屉。HTTP边界额外注入保存冲突和响应丢失，验证草稿保留与回执恢复，不验证真实供应商生成质量。

工作台导航与选区工具的回归覆盖章节级返回、功能图标导航、三页16px标题、草稿保护、来源场次及画布定位恢复、动态选区操作、输入方式切换保留范围，以及调整划分菜单。回归入口仍为 `workbench-management` 和 `workbench-division`。

`workbench-division` 同时覆盖双图标模式与选区恢复、名称原位编辑/空名/Esc、临时创建与取消、未完成阶段跨场次和整页保护、确认创建后的真实保存，以及窄屏关闭抽屉保留编辑。共享 `WorkspaceDrafts` 的保存阻断字段还需回归工作台导航和画布配置保护。

`manual-split` 为单场拆分的独立闭环回归：先选字后进入拆分，检查入口与断点保留、确认身份、保存新版本和刷新后的两场原文。它复用4386／8386端口，不与 `workbench-division` 或 `workbench-canvas-creation` 并行运行。

`division-assignment` 使用既有隔离后端验证编辑区创建、抽取影响确认与取消、并入、撤销、保存及窄屏输入保留；与 `manual-split`、`workbench-division`、`workbench-canvas-creation` 共用4386／8386端口，必须顺序运行。`divisionOperations.test.mjs` 覆盖连续性、身份、空白残段和多次分配的结果。

`object-asset-selection` 使用隔离后端验证提取只发现对象、取消不创建、共用新建与主体独立复制、场次具体文件稳定及明确复用已有项目对象；纳入 `workbench` 套件。

`resource-editor` 纳入 `management-ui`，通过浏览器验证共用抽屉、草稿预览无写入、设置应用／取消、主体采用、普通生成、局部修改候选与独立入库。`asset-detail` 覆盖保存／离开保护、检测取消、历史追加、只读类型及多视口；项目演员、角色和其他资源回归覆盖新标签页编辑及关联／删除恢复。
