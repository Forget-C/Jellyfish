# 04: 基础媒体导入与明确输出

**What to build:** 用户导入或选择图片、视频、音频，保存重开并预览；每张内容卡提供有身份、来源与可用状态的明确媒体输出。

**Blocked by:** [01 新协议下的文本生成闭环](01-text-protocol-flow.md)

**Status:** ready-for-agent

**Completion:** integrated

- [x] 图片、视频和音频内容卡可通过允许的上传、项目文件选择等入口建立，保存重开保持实际文件与来源；不新增音频生成。
- [x] 按真实媒体展示图片、视频或音频预览及必要信息，视频保留自带音轨；预览、播放和选中卡片不建立模型采用。
- [x] 输出使用强类型媒体内容、稳定输出标识、有效文件引用与必要来源；上传未完成或文件不可用时不提供有效媒体值。
- [x] 文件类型、项目归属、可用性和使用关系经过校验；跨项目或失效文件有可定位诊断，不能以任意 URL 或文件名代替有效引用。
- [x] 普通媒体卡通过明确导入、选择或另存形成自身内容，不新增持续输入；复制／另存保留只读来源，不建立反向读取。
- [x] 保存、恢复、删除及文件保护适配新增输出和引用位置；已有引用或运行历史所需文件不因卡片预览关闭而失去保护。
- [x] 不隐式执行视频取帧、音频转写或图片描述，不增加文本模型的媒体理解输入；具体模型消费由后续生成票据按能力开放。

规格依据：[总体规格](../spec.md)。共同约束与验证边界见[任务索引](../README.md)；本票实现与验证证据见下方。



## 交付记录

integrated — 已合并到 codex-generation-canvas。保持原分诊 Status，不将 ready-for-agent 当完成状态。

## 实施与验证

- 基线 `43766520`，独立工作树 `/private/tmp/jellyfish-canvas-types-04`、分支 `codex-canvas-types-04`。复用已有三类媒体上传、项目库选择、原生预览、只读历史来源和文件保护，不重建生成能力，不新增持续输入或隐式转换。
- HTTP TDD 第一轮：新增三模态上传／替换／重开出口行为，上传中因丢失输出身份而 3 failed；最小实现后 3 passed。上传时保留稳定出口身份，`available=false` 且不携带 payload/file_id，既有文件保护继续生效。
- HTTP TDD 第二轮：真实文件库 fixture 仅布置保存后被撤回的外部文件状态，通过 HTTP 观察；最初错误发布 available=true 而失败，统一读取校验后通过。失效引用无有效媒体，编译返回定位到 `input_bindings/image-input` 的 `OUTPUT_MISSING`；不 mock 内部解析器。
- 后端：`UV_CACHE_DIR=/tmp/jellyfish-uv-cache uv run --no-sync pytest tests/test_generation_canvas_api.py tests/test_generation_canvas_compiler.py tests/test_generation_canvas_lifecycle.py tests/test_generation_canvas_runs.py -q` → 59 passed、14 skipped；追加 images/video/journey/dag/selection → 32 passed、13 skipped。跳过的是需独立 MySQL 测试环境的参数，SQLite HTTP 验证不替代竞争证据。`uv run --no-sync pylint app` → 10.00/10，退出 0（默认缓存目录不可写提示不影响检查）。显式 `PYTHONPATH=.` 核实 app 来自本工作树。
- 前端：Node 24 `pnpm --dir front run typecheck` 通过。真实浏览器 `PLAYWRIGHT_CHANNEL=chrome node front/tests/generationCanvasMedia.browser.mjs` 通过；使用隔离 8275/4275，外部对象存储替身，真实路由、服务、数据库和页面。覆盖上传失败／替换失败保留旧文件、保存失败后项目库重新选择、迟到上传不复活删除卡片、三类媒体保存重开／强类型出口、音视频项目库选择与实际播放、视频保留 controls 与音轨、桌面和 390px 页面无横向溢出。
- 页面证据：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-generation-canvas-media-IVed1t/` 的 `media-content.png`、`media-content-narrow.png` 与 `backend.log`。已目视检查桌面／窄屏播放器与详情布局。新 Playwright bundled 浏览器缺失，复用本机 Chrome；未安装额外依赖。
- 独立后端公开 `openapi.json` 已导出并运行客户端生成到 `/private/tmp/canvas-media-04-generated`；JSON 与仓库 OpenAPI 完全相同，生成类型除既有尾空行外无差异，因此不提交无关生成漂移。主区 8000 未修改／停止；集成后未重复执行标准 openapi:update：8000 请求超时无响应，且工作进程启动早于本次合并，不能确认加载新代码。04 修复既定可用性契约、公开 schema 精确一致，复用 01 集成后已通过的完整生成结果；不把此次请求视作生成通过。
- 保存的跨项目／缺失／类型错误文件拒绝与原内容保护、删卡／删画布仅释放自身内容 usage、历史独立来源和运行文件保护复用相关 HTTP 回归；没有新增模型采用、音频生成、图片理解或视频取帧。

- 最终显式 `PYTHONPATH=.` 合并运行上述 9 个后端测试文件：91 passed、27 skipped；页面测试子进程也显式指定本工作树 backend 路径后复核通过。

- 集成提交 `436691a2` 无冲突；主区显式 `PYTHONPATH=.` 确认 app 来自主区 backend。Node 24 `pnpm --dir front run typecheck`、`git diff --check` 和 `git diff --cached --check` 通过；复用同一实现的 91 passed／27 skipped、Pylint 10.00/10 与真实 Chrome 页面证据。
