# 11: 严格框选与互不重叠的并行运行

Status: ready-for-agent
Blocked by: 10

**What to build:** 用户框选部分模型卡重新执行选中部分；无重叠流程可同时运行，冲突明确定位而不自动扩大范围或排队。

**依据：** [实现规格](../spec.md)；[任务依赖与共同验证](../README.md)。验收覆盖：A20、A21、A26。

## Acceptance criteria

- [x] 框选只执行所选可执行卡各一次，内容卡和分组不变成任务；即使某选中输出无人使用也执行该模型。
- [x] 范围外仅复用有效结果；遗漏选中节点间的必要中间节点或外部输入无效时，预检定位需补选／补齐对象，不自动纳入。
- [x] 范围外下游仅标记依据变化，不自动执行；没有首次／重跑／重试模式分支。
- [x] 不重叠执行范围可并行，仅共同读取也可并行；服务端受理原子校验占用，重叠返回 RUN_SCOPE_BUSY 及冲突卡片／运行。
- [x] 取消意图未达到真实终态时仍保留原占用；终态后可再次明确发起新运行，不自动排队。
- [x] 同画布一条流承载多运行，事件按运行与节点归并；一个运行结束不关闭其他运行观察。

## Validation

- 浏览器框选 A、C 但遗漏必要 B 时只报错；补选后各节点一次，其他卡不执行。
- 隔离 MySQL 多连接竞争验证重叠仅一个受理、互不重叠并行与共同读取；检查 Task 调用数量及持久占用。
- 真实 SSE 并行多运行、交错提交与重连，验证 snapshot＋cursor 不漏终态、不重复文本。
- 执行 [共同检查要求](../README.md#共同检查要求) 中适用于本票变更的命令，并记录真实结果。

## Scope and handoff

完成三种执行范围和并发契约，不修改 Task 内部调度或任务中心通道；13 使用跨模态链作综合验收。

## Completion

已实现严格框选、范围外有效复用与遗漏中间节点定位、执行范围原子占用、并行运行的统一 SSE 观察及即时下游依据失效。保留现有 Task 调度、取消终态与三种范围语义。

## Comments

- 2026-10-23：依据已确认术语和 ADR 建立实现票据，尚未开始实现或执行验收。


- 2026-10-23：完成 TDD：selection 请求原先被 422 拒绝；新增 HTTP/真实 Worker 用例后支持仅执行选中模型、拓扑排序、重复 ID 去重、内容／分组忽略、孤立选中模型执行。有效旧 B 也不能跨接本轮选中的 A→B→C；缺失位置仍为 OUTPUT_MISSING，外部失效输入定位来源。公开持久 stream 用例先复现下游有效性未推送，再由 node.finished 权威 current_outputs 修复。
- 2026-10-23：隔离 MySQL `jellyfish_check_gc11_01a16891` 迁移至 `9b11d05c742f`（只新增预检选择集合）。真实三连接竞争重叠恰一受理，共同读取 B/D 与独立 A/X 并行，取消意图保留占用，真实终态后可明确新发起；检查每次 Task 和外部受控模型调用数量、持久节点及统一有序事件。未使用付费模型或用户数据库。
- 2026-10-23：真实 Uvicorn HTTP + MySQL 提交屏障发现 PUT／预检／受理成功响应先于 commit，三场景先 RED 后 GREEN。仅画布路由改用 function scope 数据库依赖，在回包前提交；未修改全局 get_db，不用前端轮询掩盖竞争。证据 `/private/tmp/jellyfish-generation-canvas-evidence/11/http-commit-red.log`、`selection-http-green.log`。
- 2026-10-23：`JELLYFISH_TEST_MYSQL_URL=<限定测试库> uv run --no-sync pytest tests/test_generation_canvas_selection.py tests/test_generation_canvas_dag.py tests/test_generation_canvas_runs.py tests/test_generation_canvas_api.py tests/test_generation_canvas_compiler.py tests/test_generation_canvas_parameters.py tests/test_generation_canvas_images.py tests/test_generation_canvas_video.py tests/services/test_task_service.py tests/services/test_task_worker.py tests/services/test_task_queries.py tests/services/test_task_files.py tests/architecture/test_generation_worker_boundaries.py tests/services/test_task_mysql.py -q`：127 passed，无 skip；既有 websockets 两条及 Alembic 一条弃用 warning。`uv run --no-sync pylint app` 10.00；`pnpm --dir front run typecheck` 通过。日志 `11/final-tests.log`、`pylint-final.log`、`typecheck-final.log`；最终范围简化另跑 `final-scope-tests.log`。
- 2026-10-23：注册 `generation-canvas-selection` runner；`PLAYWRIGHT_CHANNEL=chrome JELLYFISH_TEST_MYSQL_URL=<限定测试库> node front/tests/run-browser.mjs generation-canvas-selection --output /private/tmp/jellyfish-generation-canvas-evidence/11/browser-selection-complete`：preflight + Chrome 8.5s 通过。真实拖框 A/B/C、去掉 B 只报错；补选 B/X/内容只执行 A/B/C/X 各一次；Y 独立完成时同一流继续观察；断流、重复事件和重连后页面正文无重复；后续仅执行 A 时 B/C 立即显示依据已变且无追加调用。真实 HTTP、generated client、TaskWorker 与 MySQL；截图及日志见该目录。先前 SQLite 并行尝试因缺少行锁产生事件游标竞争，最终并发证据均改用真实 MySQL；测试 fixture 使用唯一项目／模型身份且不重置数据库。
- 2026-10-23：已同步当前 architecture、OpenAPI 与 generated request 类型；本树使用 app.openapi 导出作为开发中契约，集成后由父核实实际 8000 当前后端再执行必需 openapi:update。没有改任务中心通道、生产调度、释放时机或文件生命周期；无功能未完成项。
