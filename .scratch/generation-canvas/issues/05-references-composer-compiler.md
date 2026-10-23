# 05: 结构化引用编辑、稳定代号与输入编译

Status: ready-for-agent
Blocked by: 03, 04
Completion: complete — 2026-10-23

**What to build:** 用户通过同一套 @ 编辑器引用实际存在的输入，重排或粘贴时保持来源身份，并能定位缺失、断线和编译问题。

**依据：** [实现规格](../spec.md)；[任务依赖与共同验证](../README.md)。验收覆盖：A07、A08、A09、A10、A11、A28、A30。

## Acceptance criteria

- [x] 保存 PromptDocument 的文本、稳定引用和系统指令结构，定位身份不依赖正文偏移或编辑器内部 JSON；已完成输入不得只保存显示字符串。
- [x] 接收端按同模态输入编号；同输出在同一接收卡只有一个代号，重排只改显示，不同来源同文件不合并；普通文字不自动改写。
- [x] @ 分类选择和手写形成相同身份；完整 token 确认前仅匹配，@图片10不能提前绑定图片1；Enter／Tab、分隔符、失焦及 IME 按规则处理。
- [x] 空卡或无结果卡可连线但不可提前引用，未知代号保留并诊断；已有缺失引用保留位置与来源，恢复同一来源位置才恢复使用。
- [x] 同画布结构化粘贴保留来源，未连接时标记并要求手工修复；跨画布不绑定／复制；外部纯文本按目标代号解析；转义保留字面语义。
- [x] 添加入口创建可见内容卡并连接，选择已有卡仅建线；引用删除不自动删候选边。
- [x] 文本仅在引用处展开，不再解析展开内容；编译记录代号、来源身份和实际输入映射，普通文字不猜测为引用。
- [x] 对模型切换保留的连接按实际使用校验：未用的不兼容候选只提示，实际使用的不兼容输入、数量超限或无效参数才阻止执行；不自动删除引用或截断内容。
- [x] 有实际引用时阻止断线／删来源并定位正文、指令或专用配置；清理后可立即操作并一次保存，不要求先保存清理。
- [x] 提供公开编译／实际使用解析入口和结构化诊断，保存不完整编辑与阻止执行分开；实际运行输入预览由后续运行票消费。

## Validation

- 公开编译边界覆盖顺序、身份、文件相同但来源不同、转义、非递归展开及失效诊断。
- 浏览器验证 IME、@长代号、分类定位、两种剪贴载荷、跨画布、添加入口、删引用后断线并保存。
- 使用真实内容卡构造引用；不得用未来输出 fixture 规避禁止提前引用规则。
- 执行 [共同检查要求](../README.md#共同检查要求) 中适用于本票变更的命令，并记录真实结果。

## Scope and handoff

向运行票提供 PromptDocument、实际使用集合、输出身份解析与基础编译结果；09 完成四条视频指令的具体能力及供应商字段映射，08 完成图片请求映射验收。

## Comments

- 2026-10-23：依据已确认术语和 ADR 建立实现票据，尚未开始实现或执行验收。


- 2026-10-23：完成 05。持久正文改为 `PromptDocument`（稳定片段、来源输出身份、指令参数与引用）；公开 `compile_card`／`resolve_outputs` 与已保存修订编译接口；单次文本展开、实际使用子集、媒体位置映射、缺失／跨画布／未连接／能力诊断及最终文档断线保护已实现。前端共用编辑器覆盖分类与行内 @ 候选、完整 token 确认、IME、转义、两种剪贴载荷、正文中间插入、原生多行、添加可见内容卡／仅连接已有卡及定位保护。视频四指令的完整供应商映射继续由 09 消费；运行与当前模型结果投影继续由 06 消费，不伪造未来输出。
- TDD 红绿记录：首次公开编译测试因缺少 compiler 模块失败；断线保护用例实际返回 200（预期 422）后加入最终文档校验；结构化首帧指令初次被基础编译器无条件阻止后补充通用用途校验；重复片段 ID 保存初次返回 200 后补充唯一身份校验。均已转绿。使用规格已确认的公开规则／真实 HTTP+数据库／真实页面接缝，没有模拟内部协作者。
- 后端：`cd backend && UV_CACHE_DIR=/private/tmp/jellyfish-uv-cache uv run --no-sync pytest tests/test_generation_canvas_compiler.py tests/test_generation_canvas_api.py tests/test_generation_canvas_parameters.py -q` → 34 passed、1 条环境条件 MySQL 用例跳过；随后以 `JELLYFISH_TEST_MYSQL_URL=mysql+aiomysql://root@127.0.0.1:32768/jellyfish_check_generation_canvas` 执行同目录 `uv run --no-sync pytest tests/test_generation_canvas_api.py -k mysql -q` → 1 passed、28 deselected。真实应用异常处理器用例核实标准封套 data 的诊断定位；SQLite 不替代 MySQL 竞争验证。
- 检查：`cd backend && UV_CACHE_DIR=/private/tmp/jellyfish-uv-cache PYLINTHOME=/private/tmp/jellyfish-generation-canvas-pylint uv run --no-sync pylint app` → 10.00/10；根目录 `pnpm --dir front run typecheck` → passed；`git diff --check` → passed。
- 浏览器：Node 22、`PLAYWRIGHT_CHANNEL=chrome node front/tests/run-browser.mjs generation-canvas-composer` → passed（最终完整用例 7.5s）；`PLAYWRIGHT_CHANNEL=chrome node front/tests/run-browser.mjs generation-canvas-graph` → passed（13.5s）。端口分别为 4275/8275 与既有 4274/8274，隔离数据库，真实文件上传，仅外部存储 I/O 替换。证据已复制至 `/private/tmp/jellyfish-generation-canvas-evidence/05/composer` 与 `/private/tmp/jellyfish-generation-canvas-evidence/05/graph`，含 runner results.json、日志、截图和隔离数据库。
- OpenAPI：本分支以当前工作树 `app.openapi()` 导出紧凑 JSON 并运行 `pnpm --dir front run openapi:gen`；父任务在合并到已核实的 :8000 工作区后执行强制 `openapi:update`。无未完成的 05 验收项；不把后续执行、供应商请求映射或活动运行删除限制标记为本票已完成。
