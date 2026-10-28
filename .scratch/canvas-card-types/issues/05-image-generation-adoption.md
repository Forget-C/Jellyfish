# 05: 图片生成与结果选择

**What to build:** 用户分别选择直接文本与图片输入，核对实际请求并生成图片；结果逐项选择、比较或另存，采用不由连线或预览决定。

**Blocked by:** [04 基础媒体导入与明确输出](04-media-content-outputs.md)

**Status:** ready-for-agent

**Completion:** integrated

- [x] 图片模型使用统一输入绑定消费文本依据与参考图片，支持明确顺序和子集；未选候选不进入请求、不扩大运行依赖。
- [x] 可选参数、参考数量、重复素材及组合限制来自已接入模型能力，前端提示与后端预检一致，不因卡片目录新增而虚构控制能力。
- [x] 编译预览列出实际文本、图片、顺序与用途，正式提交固定同一依据；自由文本不被纠错或用于猜测额外绑定。
- [x] 多结果保持有序结果集与各自身份，预览某项不自动采用第一项、全部结果或改写来源顺序。
- [x] 当前输出位置、固定产物、历史与未完成成果分别表达；新增结果只成为候选，不扩大已有采用集合。
- [x] 结果可明确另存为独立图片并保留来源，也可成为下游直接候选；不自动回写输入、建立回环或触发再次生成。
- [x] 失效选择、文件保护、取消、重开观察及错误定位随该生成路径完成，不能以已有文本链路通过代替本票行为验证。

规格依据：[总体规格](../spec.md)。共同约束与验证边界见[任务索引](../README.md)；本票交付证据与验证边界见下方 Completion 和 Comments。



## Completion

- 复用已有图片模型执行、能力、结果集、当前输出、历史及另存接口；详情区分别明确采用文本依据与参考图片，采用／取消／排序均直接维护统一 `input_bindings`，没有第二份选择状态。
- 图片编译以接收端绑定顺序形成实际请求；候选不自动进入请求，重复引用同一输出只提交一次，不同来源即使同文件仍保留各自身份并按模型能力预检。
- 运行预检直接显示编译后的实际文本与有序参考图片、位置和来源；预览结果或候选图片不改变采用。历史另存固定具体文件及运行来源，与会随来源更新的当前输出位置明确区分。
- 位置缺失保留失效绑定并定位，不回退其他结果；独立图片与历史继续保护文件。取消图片生成保留旧正式输出，重开观察不会重发模型请求。

## Comments

### 2026-10-28：实现与验证

- 起点为集成 `8451391e`；先快进复用03候选／已保存输出模块 `1b7d67a3`，随后合入最新集成 `8c67ef51`，合并提交 `854af18c`。仅 rendererRegistry 导入列表冲突，保留03采用展示与07对象卡类型；未更改其他工作树、未执行08命名参考。
- 逐行为 TDD：HTTP 新用例先复现实际媒体顺序为 a/b、接收端已选 b/a 的不一致，修复后真实 TaskWorker 请求为 b/a 且文本原样；真实页面先复现不存在独立采用按钮，再补采用／取消／排序；预检实际图片列表用例先因不存在该区域失败，补复用媒体预览后通过。原浏览器用例同步适配独立路由、单一浮动详情、弹窗关闭及窄屏 dialog 语义。
- HTTP＋真实 TaskWorker：图片 v2 独立文本／图片采用、未选候选不提交、实际请求顺序、自由文本保持原样；取消后的重开观察与旧正式成果保留；来源结果从三项缩为一项时已选第三项报 `OUTPUT_MISSING`，不回退首项，独立另存的第三项文件保持固定且删除返回409。复用原有多结果归档、失败保留未完成图片、历史另存、能力数量／重复文件限制、固定供应商路由及第三项下游请求用例。
- 最终后端：在本工作树 `backend` 中确认 `PYTHONPATH=. uv run --no-sync python -c 'import app; print(app.__file__)'` 指向本工作树 app；`PYTHONPATH=. UV_CACHE_DIR=/tmp/jellyfish-uv-cache uv run --no-sync pytest tests/test_generation_canvas*.py -q`：**103 passed、27 skipped**。MySQL 专用场景未配置而跳过，不能记作通过。
- `PYTHONPATH=. UV_CACHE_DIR=/tmp/jellyfish-uv-cache PYLINTHOME=/private/tmp/canvas05-pylint uv run --no-sync pylint app`：10.00/10、退出0。Node24 `pnpm --dir front run typecheck` 与 `git diff --check`：通过。
- 真实页面：`PLAYWRIGHT_CHANNEL=chrome node front/tests/run-browser.mjs generation-canvas-images --output /private/tmp/canvas05-verified-browser`：preflight及图片用例通过（12.3s）；隔离8277/4277、SQLite、真实页面/HTTP/TaskWorker，供应商HTTP与外部存储受控。覆盖第三项预览不采用、文本／图片独立采用与取消、前移顺序、实际预检图片列表、TEXT_REQUIRED定位、完整与未完成历史、第二项未完成成果另存及再次作为直接候选、重开和单一SSE。1440×1000及390×844截图检查，详情处于视口内并正常滚动，复用 WorkbenchButton／WorkbenchDetails／MediaPreview；未修改共享工作台控件或场次工作台。
- 页面证据：`/private/tmp/canvas05-verified-browser/generation-canvas-images/`，含 `formal-third-selected.png`、`complete-and-unfinished-history.png`、`ordered-references-and-diagnostic.png`、`multi-image-history-content.png`、`mobile-independent-adoption.png`、backend/run日志与OpenAPI。已人工查看1440px预检与390px详情截图，未发现横向越界或按钮重叠。
- 契约核对：从本工作树隔离8277服务导出OpenAPI，去除仅测试控制的 `/test/` 路径后与已提交生产schema JSON精确相同；运行现有 `pnpm --dir front run openapi:gen`，只有生成器尾空行和测试控制路由噪音，已恢复无关输出。未读取或停止主区8000；本次没有新增schema字段或HTTP路径，不声称标准8000 `openapi:update` 已执行。
- 限制：受控外部供应商与存储不证明真实供应商质量或真实外部存储可靠性；27项MySQL场景未运行。命名参考、视频用途及后续跨票行为不作为本票已验证能力。

### 2026-10-28：集成验收

- 分支 `a3e454ae` 已包含主区 `8c67ef51`，主区以 `2e1e93e9` 无冲突合并；集成代码复用上方完整后端、Pylint及真实图片页面验证。主区Node24.22.1 typecheck、工作区／暂存区及合并差异检查通过。
- 复核隔离8277导出（去除测试控制路径）与当前提交schema JSON精确一致，无公开schema或generated client变化。8000无响应，未停止或重载；复用01标准OpenAPI更新和07独立导出结果，本次未重复执行标准openapi:update。原有外部替身与27项MySQL跳过限制继续保留。
