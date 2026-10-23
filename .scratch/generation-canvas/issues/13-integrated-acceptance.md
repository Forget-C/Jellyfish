# 13: 跨模态完整旅程、协议故障与既有功能回归

Status: ready-for-agent
Blocked by: 09, 11, 12

**What to build:** 验证用户从独立画布创建到文本、图片、视频生成、局部执行、取消、恢复及清理的完整旅程，并留下可复现的交付证据。

**依据：** [实现规格](../spec.md)；[任务依赖与共同验证](../README.md)。验收覆盖：A31、A32，并核对 A01–A30。

## Acceptance criteria

- [x] 使用先产出再建立引用的文本→图片→视频流程，不用未来输出引用构造捷径；三类模型共享输入组件且实际 payload 与预览一致。
- [x] 覆盖完整规格 A01–A32，每项关联实际用例／人工验收证据；没有实现或未运行的验证明确留空，不用本票掩盖前票未完成。
- [x] 真实 SSE 验证并行、断流、重复、游标过期及最终成果；无前端状态轮询、无断线取消或自动再生成。
- [x] 保存／运行／取消丢回包、模型修改、部分归档失败及流程中断均不丢用户输入、不错误发布结果或留下永久占用。
- [x] 任务中心仍保持现有通道和通用信息，可回到画布上下文；共享组件与原实验室／场次工作台回归通过。
- [x] 对外接口、OpenAPI、generated client 同步；TaskService 写入与 contracts 依赖护栏通过，未引入场次／旧 Shot 绑定。
- [x] 真实页面验证桌面／窄屏、键盘焦点、IME、菜单、长文、媒体预览和底部参数栏；共享工作台控件变化按其设计规范验证主题隔离。
- [x] 记录实际命令、结果、隔离环境和限制；实现后才更新相应架构事实，不新建无授权 release note 或路线图。

## Validation

- 按 README 的检查要求运行影响范围内后端、架构、前端类型及浏览器回归；共享基础设施影响不明时扩展范围。
- 记录隔离 MySQL 并发验证；没有环境必须明确标识该验收未完成，不用 SQLite 代替。
- 默认所有供应商由受控替身实现；真实外部生成的有效性不由这些用例证明，也不默认花费模型费用。
- 执行 [共同检查要求](../README.md#共同检查要求) 中适用于本票变更的命令，并记录真实结果。

## Scope and handoff

交付可复现的集成验收记录和已核对的规格覆盖，报告仍未完成项；本票完成不自动授权发布、提交或其他外部动作。

## Completion

已完成：真实隔离 MySQL 的文本→图片→视频组合链按先产出再建引用执行，新增受理回执重放与实际 provider payload/preview 核对；A01–A32 逐项映射见 [acceptance.md](../acceptance.md)。范围执行、取消、unknown回包、SSE与历史另存复用已通过纵切片，13再跑相关后端40项；不声称所有故障均注入同一组合run。

实际页面完成1440/375媒体解码、媒体边界、长文与下方参数焦点检查，并实际打开截图；画布tab已移除无关章节CTA/流程提示/更多资产菜单。共享Composer保留所有原IME/粘贴/来源身份断言，专项发现分类popup异步回焦与测试输入竞争，修复测试等待popup关闭，业务编辑器未改。场次工作台`canvas-graph`、显式限定项目/资产/三类实验室的`legacy-labs`均通过。默认完整旧shell仍包含其原断言，其当前独立场次shell旧假设不作为已通过结果。

验证证据根：`/private/tmp/jellyfish-generation-canvas-evidence/13/`；精确命令、环境与限制见`validation.md`/`handoff.md`。隔离 MySQL `jellyfish_check_gc13_01a16891`已迁移至`9b11d05c742f`，从未操作用户DB。真实供应商及对象存储均为受控替身，不证明外部服务可用性或生成质量；流程中断测试使用真实TaskService启动中断入口，未kill进程；无付费调用或发布。

## Comments

- 2026-10-23：依据已确认术语和 ADR 建立实现票据，尚未开始实现或执行验收。

- 2026-10-23：提交`34f7ae9`、`c823cfc`及Composer专项合并`f005593`。`PYTHONPATH=/private/tmp/jellyfish-generation-canvas-13/backend JELLYFISH_TEST_MYSQL_URL=mysql+aiomysql://root@127.0.0.1:32768/jellyfish_check_gc13_01a16891 uv run --no-sync pytest tests/test_generation_canvas_journey.py tests/test_generation_canvas_runs.py tests/test_generation_canvas_selection.py tests/test_studio_api_responses.py tests/architecture/test_generation_worker_boundaries.py -q`（backend目录）：40 passed/0skip，2项依赖弃用警告。`import-origin.log`核实本worktree app与路由function-scope依赖。
- 2026-10-23：统一runner实际通过：`generation-canvas-acceptance`6.2s、`generation-canvas-composer`8.1s（最终13合并后强断言）、`canvas-graph`25.3s、`legacy-labs`35.9s；均Chrome且有独立preflight。前端`typecheck`通过，`lint:check`275项既有/0新增，未重置baseline；父既有190项unit和11/12Pylint复用。本票只改后端测试，不改应用Python。对外schema未变，父主集成已真实8000执行`openapi:update`且normalize零diff（`parent-api-sync.md`）。
