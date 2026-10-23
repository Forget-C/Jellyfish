# 07: 取消、运行历史与断线后的观察恢复

Status: ready-for-agent
Blocked by: 06
Completion: complete — 2026-10-23

**What to build:** 用户取消文本任务、查看历史或恢复断线观察时，看到真实状态和已保存正文，并可显式保存为独立内容卡。

**依据：** [实现规格](../spec.md)；[任务依赖与共同验证](../README.md)。验收覆盖：A22、A23、A25、A26。

## Acceptance criteria

- [x] 节点取消与整轮取消有明确目标；queued／running／已终态沿用 TaskService 行为，接收意图不等于终态。
- [x] 失败／超时／丢失取消回包不释放占用或假报取消；仍按权威 Task 状态同步，既有迟到结果策略不变。
- [x] 历史保留每次实际输入、状态及成果；失败／取消保留旧当前输出，未完成正文标记来源并允许复制／显式保存内容卡。
- [x] 为画布 Task 提供项目、画布、运行及节点来源信息，在任务中心现有业务回跳机制中增加对应定位；卡片已删除时仍能打开画布运行记录。仅新增来源与路由映射，不改任务中心状态通道或把画布专属编辑放入任务中心。
- [x] 保存为内容卡固定内容与追溯，不持续跟随原模型，不改变所有下游的当前结果选择。
- [x] 快照／恢复覆盖事件重复、游标过期、传输中断及终态回包先后；单个 run.finished 不关闭画布连接。
- [x] Task 过期、启动中断、排队取消、执行失败等非成功路径均归并为画布节点事实；不能只依赖成功 deliver 回调。
- [x] 恢复只恢复显示，不恢复模型执行，不自动取消或重发；前端不因成果非空推断成功，运行层不增加成功等级。

## Validation

- 可控真实 SSE 验证断流、重复、游标过期、最终正文替换和连接持续；检查模型调用次数不增加。
- 真实 Task 生命周期覆盖取消意图未知、已有终态和失败／取消后的累计正文。
- 浏览器验证历史→未完成正文→另存内容卡→引用，原输出仍保持原来的状态。
- 执行 [共同检查要求](../README.md#共同检查要求) 中适用于本票变更的命令，并记录真实结果。

## Scope and handoff

提供公共历史、取消、成果另存和可靠事件归并行为，供图片、视频与多节点流程复用；媒体成果文件归属由 08／09 接入同一结果协议。

## Comments

- 2026-10-23：依据已确认术语和 ADR 建立实现票据，尚未开始实现或执行验收。


- 2026-10-23：完成明确目标的节点／整轮取消，执行中使用 `running + stage=cancelling` 表达已接收意图，真实终态才释放占用；所有目标 Task 先按 ID 排序锁定，再触发事件同步。历史快照与事件公开安全固定依据，未完成成果不创建正式结果集、不替换旧当前输出。
- 2026-10-23：新增 `canvas_output_content` typed operation，准备带不可变 `origin(canvas_id/run_id/node_id/position/incomplete)` 的独立文本卡，经现有文档编辑／CAS 队列另存。校验归属、正文与完成状态，拒绝伪造来源；另存期间的后续编辑保留。任务中心沿用原通道，只补充 run/node 回跳定位，源卡删除后可打开历史。
- 2026-10-23：后端在 `backend` 运行 `JELLYFISH_TEST_MYSQL_URL=mysql+aiomysql://root@127.0.0.1:32768/jellyfish_check_generation_canvas UV_CACHE_DIR=/private/tmp/jellyfish-uv-cache uv run --no-sync pytest tests/test_generation_canvas_runs.py tests/test_generation_canvas_api.py tests/test_generation_canvas_compiler.py tests/test_generation_canvas_parameters.py tests/services/test_task_service.py tests/services/test_task_worker.py tests/services/test_task_mysql.py tests/architecture/test_generation_worker_boundaries.py -q`：76 passed。随后只增加测试、未改应用代码：`-k 'source_removed or lost_cancel'` 2 passed；扩充来源异常断言后 `-k saved_unfinished` 2 passed（MySQL + real app handler）；新增 `-k terminal_canonical` 1 passed（MySQL）。合计 78 个不同用例通过；包含真实 Worker 取消回包丢失只调用模型一次、终态规范正文替换和同一持久流后续运行。详见 `/private/tmp/jellyfish-generation-canvas-evidence/07/backend-validation.md`。
- 2026-10-23：`UV_CACHE_DIR=/private/tmp/jellyfish-uv-cache uv run --no-sync pylint app`：10.00/10；缓存目录受沙箱限制未写入，检查正常 exit 0。前端在 Node22 环境从根目录运行 `pnpm --dir front run typecheck` 通过，合并后同命令再次通过；未改共享保存实现，复用 02／06 同代码证据。
- 2026-10-23：注册真实浏览器 case `generation-canvas-history`（4277/8277）。`node front/tests/run-browser.mjs generation-canvas-history --output /private/tmp/jellyfish-generation-canvas-evidence/07/frontend/final-history`：preflight + history passed（11.3s）；实际覆盖重复事件、断流、过期游标快照、同连接多运行、未知节点取消回包／刷新仍保留占用、整轮取消、复制未完成正文、延迟另存过程中继续编辑、独立内容引用、旧正式输出不变、删源卡后的任务中心精确回跳。供应商受控替身累计调用恰好 3 次。真实 `generation-canvas-runtime` 回归：preflight + runtime passed（9.7s），见 `frontend/runtime-regression/results.json`。截图及每步证据在各目录；运行状态只经 SSE 观察，恢复不重新生成或自动取消。
- 2026-10-23：对外契约已由当前 app 本地导出并更新 generated client；最终主分支合并后，由协调者按项目要求核实真实 `127.0.0.1:8000` 后运行 `pnpm --dir front run openapi:update`。本票不调用付费模型、不重建 Task 状态机，也不实现 10 的等待节点编排；08／09 媒体成果将扩展同一来源／另存协议。交接见 `/private/tmp/jellyfish-generation-canvas-evidence/07/handoff.md`。
