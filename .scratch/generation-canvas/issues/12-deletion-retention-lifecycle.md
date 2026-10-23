# 12: 引用保护、画布删除与文件保留的完整生命周期

Status: ready-for-agent
Blocked by: 08, 10

**What to build:** 用户清理引用、删除卡片或画布时获得准确阻止原因，保留的历史和其他使用者仍能访问文件，最终无引用文件可显式清理。

**依据：** [实现规格](../spec.md)；[任务依赖与共同验证](../README.md)。验收覆盖：A28、A29。

## Acceptance criteria

- [x] 实际下游引用阻止断线／删除，定位引用；当前编辑中清理后可删并一次保存，后端校验最终文档与 revision。
- [x] 有活动运行的模型卡、画布或项目先取消并等真实终态才允许删除；取消请求未知不得放行。
- [x] 删除分组只解散；删卡不直接删媒体，仍可从画布运行历史访问已删卡成果与来源。
- [x] 内容卡、运行历史、未完成成果和活动运行各自持有文件引用，等待下游已知输入也受保护，不依赖终态 Task 自动保留文件。
- [x] 删除整个画布删除其画布历史并释放自己的引用；别的画布、项目内容或独立内容卡仍使用的文件保留。
- [x] 上传保留关系显式清理与其他引用校验衔接；成功上传但未保存、上传中删卡不产生自动误删或复活卡。
- [x] 删除或清理失败展示真实状态，可再次核实，不能部分回包就宣告所有引用已释放；沿用现有文件服务事务边界。

## Validation

- 真实数据库＋存储替身覆盖上传关系、内容卡、成功／未完成历史、活动及 waiting 输入的引用矩阵。
- 使用 08 的真实图片执行链与 10 的依赖编排，使下游在 waiting 时持有已知媒体输入；此时删除文件必须被阻止，不能仅以人工插入引用行代替完整流程验收。
- 浏览器完成被引用拒绝删除→清引用→一次保存→删卡历史可读→删画布→其他画布仍可读。
- 验证活动项目删除防护与原有文件／项目使用者回归；视频同协议组合在 13 验证。
- 执行 [共同检查要求](../README.md#共同检查要求) 中适用于本票变更的命令，并记录真实结果。

## Scope and handoff

闭合资源保留与最终释放，不增加定时临时文件租约、后台补抓或独立任务恢复。13 检查图片／视频／文本实际流程下的完整行为。

## Completion

已实现并验收。删画布在原事务内释放本画布的内容、运行输入及历史输出引用，其他画布／项目的使用者保持保护。页面提供删除结果未知后的状态核实，以及上传保留清理失败后的刷新核实；沿用既有文件删除登记与 Worker 物理清理边界。

## Comments

- 2026-10-23：依据已确认术语和 ADR 建立实现票据，尚未开始实现或执行验收。


- 2026-10-23：按已确认 Testing Decisions 运行 TDD。真实图片 Worker 的 HTTP 回归先复现“删画布后无其他使用者文件仍返回 409”，原因是 `delete_runtime` 漏清 `canvas_history`；最小修复后新增生命周期矩阵 7 项全部通过（SQLite 与专属 MySQL `jellyfish_check_gc12_01a16891`）。矩阵使用真实上传、TaskService/TaskWorker、图片成功／第三项下载失败、实际 target waiting 下游，未人工插入 FileUsage 模拟运行持有。覆盖其他画布独立内容、其他项目 asset_image、活动项目拒删、取消后历史持有、上传保留显式清理及最终文件删除登记。
- 2026-10-23：受影响组合命令 `JELLYFISH_TEST_MYSQL_URL=<专属库> uv run --no-sync pytest tests/test_generation_canvas_api.py tests/test_generation_canvas_compiler.py tests/test_generation_canvas_runs.py tests/test_generation_canvas_images.py tests/test_generation_canvas_dag.py tests/test_generation_canvas_lifecycle.py tests/services/test_task_files.py tests/services/studio/test_files_delete.py tests/services/test_file_cleanup.py tests/test_file_usages.py tests/test_files_api_responses.py tests/architecture/test_generation_worker_boundaries.py -q` 得到 96 passed、1 failed；失败是原文件响应用例缺少 S3 bucket 环境，设置受控 `S3_BUCKET_NAME=canvas-test-bucket` 后 `tests/test_files_api_responses.py` 4 passed，故组合全部 97 个用例均有通过证据。Pylint 10.00/10，Node22 `pnpm --dir front run typecheck` 通过。
- 2026-10-23：注册统一浏览器用例 `generation-canvas-lifecycle`（4282/8282），PASS 8.3s：实际图片生成→引用拒删及定位→清引用删来源仅一次保存→删卡历史可读→500 后核实仍存在→删除提交但响应丢失后核实 404→另一画布图片仍可读；实际上传内容引用阻止释放、删卡保存后释放响应丢失、刷新项目文件核实并显式删除无引用文件。`generation-canvas-media` PASS 6.4s，覆盖上传／替换失败、保存失败项目库可用、上传中删卡迟到不复活、音视频预览；仅将旧测试替身错误回包同步为当前真实 data 封套。
- 2026-10-23：项目删除最初在未开启 FK 的 SQLite fixture 中出现残留表象；对照真实 MySQL 证明现有级联已正确释放本项目关系，因此未扩散修改项目 API。相关架构事实已同步；无 schema/client 变化，最终集成 8000 的全量 OpenAPI 更新由集成协调统一执行。原始日志、截图、迁移及交接在 `/private/tmp/jellyfish-generation-canvas-evidence/12/`。
