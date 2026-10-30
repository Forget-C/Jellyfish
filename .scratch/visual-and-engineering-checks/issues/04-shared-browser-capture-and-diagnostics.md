# 04: 共享浏览器采集准备与失败诊断

**What to build:** 维护者通过现有浏览器用例得到位置可信的四类卡片图片和可定位的失败证据；跨视口、工具栏换行和邻卡相交不再被截图或原生焦点滚动误导，原有业务断言保持。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] 优先扩展现有helper和运行器输出，并在四类C视觉及共同外壳用例中实际复用；完成真实页面行为，不另建纯helper框架或机械改写全仓测试。
- [x] 普通采图按可见工具栏／筛选实际边界，通过公开焦点、键盘和必要邻卡移动使标题与主体可读；跨视口后出屏卡片恢复可见，不用固定手机安全高度或私有状态注入。
- [x] 靠左／右／底边回归保留待测位置，再执行真实产品打开、限位或最小平移；不能在遮挡断言前将待测卡片移到安全区。
- [x] 采用不会触发原生页面滚动的焦点准备及原尺寸区域采集，整页与局部保持同一视口／缩放／内容上下文；使用明确加载和布局条件、有界等待，不全局替换浏览器焦点或滚动API。
- [x] 初始可达与明确滚动后的可达分别验证；必要控件保留真实中心命中或键盘动作。不能只依靠bounding box、CSS可见或自动scrollIntoView判断默认操作可达。
- [x] 失败尽力记录原始错误、整页／局部图、视口与缩放、面板／正文／工具栏矩形、clientHeight／scrollHeight、滚动、命中和焦点／inert状态；采图或页面已关闭等诊断异常不覆盖原错误。
- [x] 复用首次重开／未知元信息、异步加载、竖图完整显示、长文、空态、只读与展开会话回归；真实验证采集不会采用候选或发起模型，保留旧业务断言。
- [x] 通过故意遮挡／失败的页面场景验证诊断和可达检查能报错；保持既有端口占用保护、外部进程保护、日志和超时／中断清理。产物格式兼容既有索引，新增信息用于诊断，不要求05先完成。

**规格覆盖：** User Stories 36、37、38、39、40、41、42、43、44、45、46。

## 依据与边界

依据[独立规格](../spec.md)与[本轮索引](../README.md)。本轮已确认公开CLI、临时Git仓库／worktree和真实页面验收接缝；供应商与外部存储沿用受控替身，业务HTTP复用既有入口。测试观察退出码、结果、实际Git行为、真实页面及原图，不依赖私有函数或复制实现公式。

按实际改动运行必要检查，只有应用后端或公开契约变化才增加对应同步与验证。保留既有生成画布业务、旧01–60及前期环境检查完成记录；不新建平行运行器或为少量相似代码机械抽象。

## Comments

- 2026-10-30：用户确认七张纵向票据及阻塞关系，授权创建文件和更新依赖图；本轮暂不开始实现。Status仅表示分诊状态，所有验收待实际执行，不预记Completion。

- 2026-10-30（票04实现，待整合）：在既有 `generationCanvasWorkbench.browser-helpers.mjs` 增加公开键盘焦点／布局准备、初始中心命中、原尺寸区域采集和尽力失败诊断，实际接入共同外壳与四类 C 用例。普通采图测量真实 header、筛选与侧栏，在响应式布局稳定后移动目标及相交邻卡；靠边用例只使用显式坐标移动，记录打开前后位置和 default／expanded 命中，不执行普通安全区准备。`matrix.json` 原字段保持，新增 `capture-contexts.json` 保存 viewport／zoom／scroll／region。
- TDD 接缝为用户确认的真实页面与公开 CLI：命中检查、失败诊断、跨视口准备分别先因缺能力失败，再通过；手机缩窄暴露了响应式测量过早与容差使标题落在筛选下的问题，保留实际失败图／几何后修正稳定测量和移动容差。普通捕获还验证真正出屏与邻卡相交、手机筛选换行、初始命中与明确 `ControlOrMeta+End` 后命中分开记录、区域 PNG 尺寸及页面位置不变。实际阅图发现右上鼠标触发背后“前进”提示，采集改用真实鼠标移开并等待 tooltip 消失，保留真实 hover 回归。
- 失败产物 `failure-diagnostics.json` 保存原错误／stack、viewport／zoom、面板／正文／操作条／筛选矩形、client／scroll 高宽、滚动位置、命中元素与 focus／inert。每项诊断独立尽力采集；页面关闭时记录 geometry／page screenshot／editor screenshot 的缺失原因，catch 仍抛原错误。公开负例为 `CANVAS_CAPTURE_FAILURE=blocked-control|closed-page node front/tests/run-browser.mjs generation-canvas-common-shell --output <新目录>`；前者故意遮住真实关闭按钮，后者关闭真实页面再抛原断言，两者须 exit 1。
- 已通过（Node 24.22.1，`PLAYWRIGHT_CHANNEL=chrome`）：公开 `generation-canvas-common-shell`（含三视口、跨视口、邻卡、tooltip、故意失败及滚动证据），`generation-canvas-four-card-acceptance`（36组 F01–F12、原导入／替换／采用／单模型／映射／历史／重开断言及12个靠边 default／expanded 真实动作）；矩阵采集前后通过 HTTP 核对文件／采用／模型身份及供应商调用数不变。公开 `generation-canvas-image-editor`、`generation-canvas-editor-height`、`generation-canvas-editor-scroll` 复用未知元信息首次重开、异步图片、竖图、只读、长文、受限高度与展开收起回归，均通过。
- 已通过：`pnpm --dir front run typecheck`、`pnpm --dir front run test:unit`（含 `checkCommands.test.mjs` 端口／外部进程保护、跨 cwd 串行、失败日志、超时与中断清理）、`pnpm --dir front run lint:check`（275 项存量、0 新增）、修改脚本 `node --check` 和 `git diff --check`。未改应用后端或公开契约，无需 Pylint 或 OpenAPI 再生；未执行远程 CI。
- 本机证据：`/private/tmp/checks04-common-clean-pointer/generation-canvas-common-shell/`、`/private/tmp/checks04-four-card-final/generation-canvas-four-card-acceptance/`、`/private/tmp/checks04-negative-obstruction/generation-canvas-common-shell/`、`/private/tmp/checks04-negative-closed/generation-canvas-common-shell/`；其他回归位于 `/private/tmp/checks04-generation-canvas-{image-editor,editor-height,editor-scroll}/`。这些是可复核运行产物，不是目标基线或视觉签收。实际查阅范围包含手机共同外壳原尺寸图、手机图片默认整页图及采集位置；完整36组视觉审阅交由独立后续验收，不以产图或行为通过宣称视觉通过。
- 最终复验：同步 integration `4f79cb19` 后，共同外壳真实 hover／出屏／相交／初始与主动滚动回归通过（39.6s）；最终无 hover 污染的四类矩阵与业务／边缘回归通过（111.5s）。该矩阵含36组、108份 PNG 原图及36份上下文记录，12项靠边记录保留打开前后坐标及初始／展开命中。实际查看最终 `F04-image-default-390x844-page.png`，确认先前“前进”tooltip已消失；该查看仅验证采集干净，不代替36组设计签收。
