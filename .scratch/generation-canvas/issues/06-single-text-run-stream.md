# 06: 单张文本模型的预检、执行与持久事件流

Status: ready-for-agent
Blocked by: 02, 05
Completion: complete — 2026-10-23

**What to build:** 用户保存并预检一张文本模型卡后执行，文本从真实后台 Task 逐段显示，刷新可恢复观察，完整成功后成为正式输出。

**依据：** [实现规格](../spec.md)；[任务依赖与共同验证](../README.md)。验收覆盖：A16、A17、A18、A19、A26、A27、A30、A31。

## Acceptance criteria

- [x] 建立画布自己的 Task target、operation×target×delivery 校验、项目归属和交付；Task 写入经 TaskService，通用 DTO 在 contracts，不借用实验室消息作为结果归属。
- [x] 保存当前编辑→预检→preview_token 提交→run_id；本地内容修改立即失效旧预检，迟到预检不能放行，布局不影响；服务端复核 revision／实际输入／有效配置。
- [x] 同请求与回执原子持久化，丢回包重放同 run／Task，不同请求 ID 才形成独立执行；供应商受理未知不得盲目重发。
- [x] 单卡只执行自己一次，读取已存在且有效的实际输入；没有有效输入就定位阻止，不补跑上游。
- [x] 任务受理时冻结有效文本模型参数和供应商路由；执行层使用固定配置，运行期间改输入／模型不改变真正发送的请求，不新增变更监听或 Task 恢复保证。
- [x] 接入后台文本流，累计正文与有序小片段持久化；一条画布 SSE 推送 snapshot、node.updated、text.delta、node.finished、run.finished；状态、成果和事件同事务落账后推送。
- [x] 初始快照、恢复游标、重复去重及过期快照具有最小完整实现；离开页面不取消，浏览器恢复不重新请求模型，成功前增量不是正式输出。
- [x] 完整归档交付后产生独立 ResultSet；相关配置已改则只入历史，当前输出更新不推进文档 revision；失败／取消亦有真实终态和成果清单。
- [x] 受理执行节点占用并拒绝再次重叠执行；活动模型卡／画布／项目不可删除。前端使用 generated 契约与公共流式 transport，不用状态轮询、不迁移任务中心。

## Validation

- 真实 HTTP＋数据库＋TaskWorker，FakeModel 分段返回；检查真实调用参数、调用次数、增量持久化、回执和当前输出。
- 浏览器保持流打开时观察多次增量，刷新恢复；不能用一次性 JSON 响应伪装流。
- 覆盖本地编辑及迟到预检、受理后修改模型／路由、成功与失败交付；并发幂等用隔离 MySQL。
- 执行 [共同检查要求](../README.md#共同检查要求) 中适用于本票变更的命令，并记录真实结果。

## Scope and handoff

交付可演示的单卡完整链路及公共运行／事件／结果契约。07 扩充取消、历史和故障恢复场景；不得把事件持久化或刷新恢复留成占位。

## Comments

- 2026-10-23：依据已确认术语和 ADR 建立实现票据，尚未开始实现或执行验收。


- 2026-10-23：完成 06 单卡文本纵向切片。`canvas_node` 目标、提交矩阵、项目来源和独立交付接入真实 GenerationSubmitter／TaskService／TaskWorker；不创建实验室消息。保存→预检→凭据提交、原回执优先、原子占用、固定有效请求与私密供应商路由、后台 `astream` 增量、ResultSet／正式指向与编辑文档分离、活动卡／画布／项目删除保护均已落地。完整成功才发布正式结果，相关依据变更只入历史；旧正式指向保留并用 `basis_current` 标明有效性，实际引用结果集身份纳入依据。未使用候选和显示代号变化不使成果失效。
- TDD：真实 HTTP 预检最初 404；已有画布升级后首个快照最初 404；新增未使用候选导致 `basis_current` 最初为 false。各自以真实接缝复现后实现并转绿。已复用规格确认的测试边界，不模拟 TaskService／Submitter／Worker 等内部协作者。
- 持久事件：TaskService 领取／进度／所有终态均在原事务同步画布事实，含失败、排队／运行取消、过期及旧 Worker 启动中断；累计正文和有序片段持久化。每画布 head 行锁序列化提交游标，快照使用同锁，SSE 每次追读使用新短事务并在 yield 前释放锁；旧／超前游标恢复快照，断线不重发模型，一次运行结束不关闭多路共用连接。迁移 `473ab089b58f` 为已有画布回填 head，不改变文档 revision。
- 后端最终命令（backend 目录）：`JELLYFISH_TEST_MYSQL_URL='mysql+aiomysql://root@127.0.0.1:32768/jellyfish_check_generation_canvas' .venv/bin/python -m pytest tests/test_generation_canvas_runs.py tests/test_generation_canvas_api.py tests/test_generation_canvas_compiler.py tests/test_generation_canvas_parameters.py tests/services/test_task_worker.py tests/services/test_task_service.py tests/services/test_task_queries.py tests/services/test_task_mysql.py tests/architecture -q` → **75 passed**，没有跳过，仅既有 Alembic path_separator deprecation warning。覆盖真实独立 MySQL 连接的相同请求竞争、重叠占用、未提交增量／快照一致切点、两个 Task 的提交事件顺序、提前普通读取后的活动删除保护及迁移结构。隔离 MySQL 未重置／删除，未访问用户数据库。
- 扩展受影响共享边界：backend 目录 `.venv/bin/python -m pytest tests/services/generation tests/core/contracts/test_generation_contracts.py tests/services/test_task_submission.py tests/services/test_task_files.py tests/test_generation_tasks_api.py tests/test_lab_generation_tasks_api.py -q` → **32 passed**。最后迁移字段引号调整后单独复跑 `tests/test_generation_canvas_runs.py -k migration -q` → **1 passed**；实际 MySQL 对回填语句以 WHERE 1=0 解析执行成功。
- 检查：backend 目录 `UV_CACHE_DIR=/private/tmp/jellyfish-uv-cache-06 PYLINTHOME=/private/tmp/jellyfish-pylint-06 uv run pylint app` → **10.00/10、exit 0**。首次 sandbox 下 uv 遇 macOS SystemConfiguration NULL-object panic，同命令在正常系统权限下通过。前端 helper 与合并者在 Node22 下 `pnpm --dir front run typecheck` 通过；`git diff --check` 通过。
- 浏览器：`PATH=/Users/extreme/.nvm/versions/node/v22.21.1/bin:$PATH PLAYWRIGHT_CHANNEL=chrome node front/tests/run-browser.mjs generation-canvas-runtime` → owner 合并后 **PASS 9.1s**；增强的真实视口包含断言版本 **PASS 8.3s**。使用隔离真实 HTTP／DB／TaskWorker，仅模型边界可控；通过真实缩小／卡内滚轮暴露正文，供应商 release=0／1 时分别截图第一段／第一段第二段，两次均在最终 release=2 之前且只调用一次模型。覆盖刷新恢复、丢受理回包原身份重放（含刷新）、保存失败、迟到预检、本地编辑立即失效、布局保留、运行中编辑、失败与旧正式结果、下游候选及任务中心业务回跳。图编辑与 Composer 浏览器回归通过。
- 公共 transport：`PATH=/Users/extreme/.nvm/versions/node/v22.21.1/bin:$PATH node --test front/tests/eventStream.test.mjs` → **2 passed**，真实可控回环 HTTP 覆盖拆分 Unicode、CRLF／多行 SSE、EOF 前到达、generated 鉴权、游标恢复／去重及快照替换。普通命令及流地址发现均使用 generated operation/type；运行状态无轮询。
- 证据保存在 `/private/tmp/jellyfish-generation-canvas-evidence/06/`：后端精确命令与结果 `backend/validation.md`；owner 合并后结果 `runtime-final-owner/results.json`；真实可见增量 `frontend/visible-increments-scroll/generation-canvas-runtime/stream-first-increment.png`、`stream-second-increment.png`，对应 runner 结果在其上层 `results.json`。其他真实 graph／Composer／任务回跳证据在 frontend 子目录。
- OpenAPI／handoff：开发 client 来自本工作树真实 `app.openapi()`，无手写画布业务 service；父任务在集成到已核实的 :8000 主工作区后执行规定的 `pnpm --dir front run openapi:update`。07 可直接复用 CanvasRuntime、`sync_task_fact`、head 事务顺序和持久 SSE，只扩展历史／取消命令；不把事件持久化、刷新恢复或失败／取消／过期同步留给 07。
