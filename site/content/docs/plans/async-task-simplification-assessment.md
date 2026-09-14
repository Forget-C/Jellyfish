---
title: "异步任务体系简化评估"
description: "以简单、高效、历史可查为目标：媒体继续查询远端任务，文本中断后不恢复，删除通用恢复执行框架。"
status: accepted
date: 2026-09-11
---

## 结论与评估边界

建议将目标架构收敛为 **MySQL 任务表 + 独立 asyncio Worker（提交、状态轮询、结果收取）+ 持久化产物**。任务表同时承担待执行队列、远端任务关联和历史记录。删除通用执行恢复框架，但保留供应商受理 ID 的持久化，以及重启后继续查询、收取结果的能力。

对于已被异步供应商受理的图片、视频，计算与生成状态由供应商维护，本地没有需要重建的计算现场。继续按远端 ID 查询并收取结果值得保留。文本成本较低，中断后不恢复，由用户重新提交。

异步供应商成功响应必须包含任务 ID；缺少 ID 或必要执行数据时直接标记 failed，不设计 unknown 中间状态、受理对账或自动重新 create。表结构建议从当前 11 张直接相关表收敛为 `tasks / task_inputs / task_outputs / files` 四张核心表，详见 [任务与文件表结构简化方案](/docs/plans/async-task-schema-simplification/)。

本地任务状态以 `tasks.status` 为唯一真相，`TaskService` 是完整生命周期的唯一维护入口。提交、领取、远端状态记录、取消、超时和终态均经过此入口；Worker、Poller、业务 handler、API 和清理脚本不得直接改任务生命周期字段。供应商维护远端生成事实，本地 remote_status 只是观察快照；远端完成且本地结果保存、交付处理完成后，TaskService 才能判定任务成功。

该评估已采纳并完成工作区实现。本文保留改造前的分析依据；当前架构见 [任务执行架构](/docs/architecture/task-execution/)，实施与真实验证结果见 [表结构简化方案](/docs/plans/async-task-schema-simplification/)。旧 durable async 执行目标已由本方案替代。

本次按以下解释评估：

- 不要求通用执行恢复：不恢复本地调用栈、步骤检查点、Attempt 或自动重新生成。异步媒体已保存远端 ID 时，重启后继续查询同一任务并保存结果；文本中断归档失败，用户重试创建新任务。
- 按供应商交互方式分类：异步返回远端 ID 的图片/视频走提交与查询；同步返回内容的图片走一次请求，中断且没有可查询 ID 时不自动重发。不能仅按“图片/视频”模态推定都支持异步查询。
- 未领取的排队任务可以在 Worker 重启后首次执行。这是消费待办，不是恢复执行。若连排队任务也要随重启作废，需要另行确定该产品语义。
- 历史可查：不仅可查成功结果，也能查失败、取消、超时、输入快照、业务来源和稳定产物；不要求逐 token 日志或每次底层网络调用的完整轨迹。
- 工作负载以当前文本、图片、视频的远端 I/O 为主。不预设高吞吐短任务、DAG、跨机恢复、任务优先级或严格全局公平调度需求。
- 按目标模型直接设计，不受旧表名、旧外键、旧 API 或双轨兼容限制；本轮不设计历史迁移。新体系仍必须保证使用过程中形成的任务历史可查，本轮不执行任何数据删除。

本次完成了代码路径核对和开源资料调研，没有运行真实供应商任务或生产压测。下文的性能收益是结构分析，具体容量、并发数、延迟必须验证。

## 改造前实现的关键问题

| 已核对的实现 | 对本次目标的影响 | 建议 |
| --- | --- | --- |
| `GenerationTask` 之外还有 `GenerationRun`、`GenerationRunDispatch`、`ProviderOperation`、生成 outbox；媒体另有 Blob 与存储 outbox | 一次请求跨多个状态机；很多转换服务于恢复与重复投递 | 用一个 Task 表表示一次执行，产物保留独立业务记录 |
| `run_task_celery` 按任务种类分出 durable async 与旧 executor；前者每次 `asyncio.run`，并重置、关闭 DB runtime | 维护同步、异步两套路径；一个长轮询任务仍占一个 Celery 执行槽 | 常驻异步 Worker，共用事件循环和连接池 |
| `GenerationRunReaper` 回收租约后写重新投递事件 | 把查询远端任务包装为本地执行恢复 | 有远端 ID 的媒体由轮询器继续查询；本地任务按中断/超时归档，不再重排队 |
| `submitter._require_durable_media_recovery` 要求远端句柄、按句柄轮询和取回结果 | 恢复要求成为供应商接入门槛，同步返回图片的能力会被拒绝 | 支持同步返回与异步轮询两类正常执行路径 |
| 媒体主执行完成后，物化 Worker 按 receipt 再取结果、下载并上传 | 一份结果跨任务交接，多一轮查询与调度；多产物还可能分别取回同一远端结果 | 查询发现成功后直接收取整组结果；未完成保存时仍凭同一远端 ID 再取，不引入独立物化任务状态机 |
| `TaskManager` 为创建任务需要 `_CreateOnlyTask`，传入空策略表；Worker 另走 registry | 通用抽象未简化实际调用 | 直接 `submit(kind, snapshot, target)`，保留一张 handler 映射 |
| 全局列表每 4 秒取第一页 50 条、只带最近结束 15 秒；请求失败时清空前端列表 | 活动摘要不等于历史入口；超过 50 条不完整，短暂失败导致任务消失 | 活动列表与历史查询分开；失败保留最后一次数据并标记过期 |
| 列表查询先 count、查 ID、再读取完整 Task ORM 和关联 | 高频轻量状态查询仍加载 payload/result JSON | 直接投影必要字段，历史详情按需加载 |

代码定位：

- `backend/app/models/task.py`
- `backend/app/models/generation_runs.py`
- `backend/app/models/generation_run_dispatches.py`
- `backend/app/models/provider_operations.py`
- `backend/app/tasks/execute_task.py`
- `backend/app/services/generation/runtime/reaper.py`
- `backend/app/services/generation/submission/submitter.py`
- `backend/app/services/generation/storage/materializer.py`
- `backend/app/services/script_processing_tasks.py`
- `backend/app/core/task_manager/stores.py`
- `front/src/pages/aiStudio/components/TaskRuntimeProvider.tsx`

另一个部署核对项：代码配置了每 10 秒 outbox 派发和每 30 秒租约回收，但仓库 Compose 仅启动 Celery Worker，没有 Beat 服务或 `-B`。不能据此断言实际环境没有独立 Beat；可以确认的是仓库内默认部署没有闭合这一依赖。若只靠 10 秒周期派发，空载等待还可能增加接近一个调度周期，实际延迟未测量。

## 开源项目的参考价值

| 项目 | 官方实现或文档体现的取舍 | 对 Jellyfish 的结论 |
| --- | --- | --- |
| ComfyUI | `PromptQueue` 将排队、运行中、history 分开，完成时记录输入、输出、状态；该类的 history 是有上限的内存字典 | 借鉴清晰的执行与历史语义；历史需改为数据库持久化，不能直接照搬内存实现。[源码](https://raw.githubusercontent.com/Comfy-Org/ComfyUI/master/execution.py) |
| Procrastinate | 利用 PostgreSQL 锁领取任务，并以 LISTEN 通知；官方明确讨论复用业务数据库、减少额外 broker 的运维负担 | 最贴合本次简化方向；借鉴数据库队列模式。它依赖 PostgreSQL，不应为引入该库迁移整个 MySQL。[设计说明](https://procrastinate.readthedocs.io/en/stable/discussions.html) |
| arq | 原生 asyncio，使用协程并发 I/O；默认悲观执行，进程退出后任务留队重跑 | 借鉴异步执行方式；直接替换 Celery 仍带来 Redis 与重复执行语义，需要额外限制，收益不如一次收敛。[文档](https://arq-docs.helpmanual.io/) |
| Celery | 可只用执行层；官方建议长短任务分流并控制预取 | 保留精简 Celery 是低迁移成本备选，但不是本次从目标出发的首选。当前已设置 `task_ignore_result=True`，无需重复建设结果 backend。[优化文档](https://docs.celeryq.dev/en/stable/userguide/optimizing.html) |
| RQ / Dramatiq | RQ 默认结果有 TTL，并对遗弃任务做失败归档；Dramatiq 默认自动重试 | 借鉴“中断归档失败”和简洁 handler；不能将 broker 的临时结果等同于产品历史，也不能沿用自动重试默认值。[RQ](https://python-rq.org/docs/results/)、[Dramatiq](https://dramatiq.io/guide.html) |

MySQL 官方说明 `SKIP LOCKED` 适用于多个会话竞争队列式表。因此推荐方案不需要模拟 Redis，也不需要引入一个 PostgreSQL 专用任务库。[MySQL 锁读取文档](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html)

### 候选方案比较

| 方案 | 运维与一致性 | 执行效率 | 判断 |
| --- | --- | --- | --- |
| API 进程内 `create_task` / 内存队列 | 进程最少，但 API 扩容、退出、后台任务所有权和数据库入队间隙需要自己处理 | 适合受控单进程原型 | 不作为当前独立 Worker 部署的目标 |
| MySQL 队列 + asyncio Worker | 一次 DB 提交即入队，无 broker 双写；需维护小型领取、终结、超时循环 | 适合当前长耗时 I/O；轮询对 DB 的影响须实测 | **推荐** |
| 精简 Celery + Redis + MySQL | 成熟运维工具；仍要处理 DB 与 broker 投递间隙 | 可用，但 prefork 下长等待占槽 | 若不愿维护领取循环，作为备选 |
| arq / Dramatiq 等替换 Celery | 仍有 broker 和状态库两套数据、框架默认重试语义 | arq 对异步 I/O 友好 | 单纯换框架无法消除当前核心复杂度 |

数据库队列需要自有代码和维护，并不天然比所有库简单。范围应限制为“领取提交一次、按远端 ID 查询、收取结果、终结”。若需要优先级、复杂依赖、全局配额、本地步骤自动恢复，应重新选型，不能逐步自研完整调度平台。是否删除 Celery 是第二层选型；先确定这组执行语义，不能仅以换框架作为简化成果。

## 推荐执行模型

```text
API → TaskService.submit → MySQL tasks（queued + 输入快照 + 来源）
                              ↓ 短事务领取
                      独立 asyncio Worker
                       ├─ 文本/同步图片：请求 → 保存 → 终态
                       └─ 异步媒体：提交一次 → 保存远端 ID → 释放提交槽
                                              ↓
                            到期查询远端 ID（重启后照常扫描）
                               ├─ 未完成：更新 next_poll_at
                               └─ 已完成：收取结果到自有存储
                                              ↓ 短事务
                                产物 + 领域交付 + Task 终态

活动列表 / 历史查询 ← MySQL tasks + 产物引用
```

### 领取与并发

1. API 的业务校验、Task 和必要关联在一个事务提交。没有独立 enqueue 网络调用，不再需要生成派发 outbox。
2. 提交器只在有空闲容量时领取。用 `SELECT ... FOR UPDATE SKIP LOCKED` 选取 queued 任务，在同一短事务改为 running、记录启动时间与提交器进程实例 ID，提交成功后才调用 Provider。文本和同步请求记录执行截止时间；异步媒体分别设置提交请求超时和结果跟踪期限。
3. 若领取事务未确认提交成功，不启动 Provider。若异步供应商响应缺少 ID，直接失败；若进程退出导致本地没有保存 ID，启动清理时标记失败，不重新提交。
4. 每个 Task 最多一次从 queued 转 running；running 永不回 queued。异步媒体受理后立刻保存远端 ID、供应商/账号配置引用、非敏感路由身份和 next_poll_at，然后释放本地提交槽。后续调用只能查询同一远端任务，不能再次 create。
5. 轮询器扫描到期的非终态媒体，每次只进行一次状态请求。未完成则更新 next_poll_at；短暂网络错误仅记录 last_poll_error 并退避，不能直接判供应商生成失败。供应商轮询频率限制优先于本地刷新需求。
6. 初始采用一个独立 Worker 进程，在同一进程内运行提交、轮询、结果收取循环；运行中的 poll 用内存 task_id 集合避免本进程重复调度。重启后读表继续扫描，无需恢复旧协程、长期租约或 Attempt。
7. 文本请求、媒体提交、单次 poll、媒体下载分别限制并发。等待供应商生成的记录不占本地提交槽，但仍计入供应商远端在途配额；不能因为轮询轻量就无限提交。
8. 共享进程级 HTTP/数据库连接池，不共享并发中的 SQLAlchemy Session；网络等待期间不持有 DB 事务或已借出的连接。阻塞存储 SDK 用有界线程池，CPU 重任务另行隔离。

默认部署要求一个有效轮询/收取进程，停旧再启新，不承诺滚动重叠运行。以后增加进程，才引入轮询分片或短请求级领取，并调整配额；不能直接把单进程内存去重当作跨进程互斥。提交原子领取和终态事务仍需在实际 MySQL 上验证，SQLite 不能验证相同锁语义。

### 状态、取消与中断

任务主状态只保留 `queued / running / succeeded / failed / cancelled`。正在轮询、下载、上传用 `stage` 表示，不增加一套可恢复状态机；streaming 是交付方式，不作为异步任务生命周期状态。

- queued 取消：TaskService 在事务内条件更新为 cancelled，Worker 领取时自然跳过。
- running 取消：写 `cancel_requested_at`；Worker 在阶段边界检查，支持时调用远端取消。Provider 不支持停止时，也可结束本地等待，但历史明确记录远端是否停止未知。
- 取消与成功竞争：统一终结函数锁定 Task，检查仍为 running、未超过 deadline，并读取取消意图。取消先提交则阻止后续自动领域发布；成功先提交则取消成为无操作。
- 正常停机：停止领取；已保存远端 ID 的媒体保持非终态，停止本地查询即可。文本和没有查询能力的同步请求给有限退出时间，未完成则标记中断。
- 强杀后启动：单 Worker 前提下，根据旧进程实例 ID 识别未结束的本地文本/同步任务并标记中断；已保存远端 ID 的媒体继续查询，不因本地进程退出失败。异步媒体缺少 ID 则标记失败，不自动重发。
- 跟踪期限到达：区分本地不再跟踪与供应商明确失败。媒体先做一次最终状态核对；确实仍未完成或无法确认时，按产品期限归档本地失败，记录 `tracking_expired` 及远端状态未知，不宣称供应商已经停止。跟踪期限需结合供应商正常耗时、结果保留期确定，不能直接复用文本执行超时。
- queued 也有明确的最长等待期，过期不再启动，归档为 `queue_expired`。
- 迟到结果不得覆盖终态，也不得先修改领域数据再检查 Task。所有 DB 交付必须与 Task 条件终结处于同一事务。

不要求恢复仍然需要终态保护和业务版本检查。它们解决取消竞争、重复提交和旧结果覆盖新编辑的问题，与租约恢复是不同需求。

缺少必要数据采用明确失败策略：异步响应缺 ID 记录 `provider_task_id_missing`；进程退出导致提交信息未保存，记录 `submission_interrupted`；无法构造查询请求则记录相应的数据错误。统一进入 failed，不增加不确定状态、人工对账队列或恢复查询协议。失败表示本地任务无法继续处理，不声称供应商一定未受理或已经停止。

供应商的生成状态是远端事实来源，本地 Task.status 表示应用端处理结果。例如远端已成功但本地尚未保存文件时，Task 仍为 running；网络错误、取消本地等待和存储失败都不能伪装成供应商生成失败。

### 简化媒体交付

同步供应商直接返回 bytes、base64 或临时 URL 时，在请求完成后转存对象存储。异步供应商由轮询器发现成功后交给同进程的有界收取逻辑，按同一远端 ID 获取完整结果；删除的是重复的恢复调度模型，不是跨重启继续查询的能力。

按 `task_id + ordinal` 生成稳定对象 key，并对产物使用相同唯一约束。上传完成后再开启短事务，写入产物、任务结果与业务投影。未完成转存不记 succeeded；瞬时下载/上传失败可退避再收取，明确不可取回或超过期限才以存储/结果过期原因结束。大视频使用流式下载/上传或受控临时文件，避免多并发全量驻留内存。

对象存储与数据库不能原子提交。上传成功、DB 提交前崩溃时，有远端 ID 的任务下轮仍可继续收取，先检查固定 key 的完整对象再决定是否重传，DB 产物唯一约束和终态条件更新避免重复发布。此处只保证重复收取安全，不恢复多步骤工作流。无法继续的孤儿对象用独立维护清理，按存储前缀、DB 引用和安全宽限期扫描；清理排除仍在跟踪/收取的任务，已有稳定产物不得误删。

如果结果生成成功但目标已经被编辑，保存产物与历史，记录 `delivery_status=conflicted`，不覆盖新版业务数据。取消前已经保存的产物可留作历史，但不能自动采用。目标表结构中，媒体产物关系放 `task_outputs`，物理文件统一放 `files`，删除独立 Blob 表；保留的是产物与文件职责，不保留原有表结构。

存储物化 outbox 的删除以完成上述替代路径为前提。删除任务、删除产物、孤儿清理仍需明确规则，不能把“不恢复执行”理解为“不管理文件”。

## 历史可查的最小契约

一次用户提交对应一条 Task；再次生成创建新 ID，可记录 `retry_of_task_id`，原记录不重置。

| 内容 | 建议保留 |
| --- | --- |
| 标识与来源 | task_id、kind、项目/业务对象关联、来源标题快照；有用户隔离时保存并校验归属 |
| 执行状态 | status、stage、progress、cancel_requested_at、created/started/finished/deadline |
| 远端跟踪 | provider_task_id、provider/account 配置引用、非敏感路由身份、remote_status、next_poll_at、last_polled_at、last_poll_error |
| 输入 | 有效参数、最终实际请求快照、提示词/模板版本、模型与供应商非敏感身份、不可变参考文件 ID 与排列 |
| 输出 | 结构化文本结果或稳定 artifact/file ID；生成成功与领域采用结果分开 |
| 诊断 | error_code、简短错误说明、已知远端 ID、耗时；usage/费用仅在供应商确实返回时保存 |
| 重试关系 | retry_of_task_id，不通过覆盖旧 task/result 表达“再试一次” |

最终实际输入在提交或执行开始、配置解析完成后冻结，不能只存指向可变模型配置的 ID。历史快照不保存 API key、Authorization 或带凭据的临时链接。详细提示词留在业务详情中，任务中心只展示通用信息。

最小方案不需要 TaskEvent 表；结构化日志带 task_id 即可。仅当用户要求完整阶段审计时，再增加少量阶段事件，不能默认存每次 poll、heartbeat、token。

API/界面建议：

- 活动列表返回轻量列，按需批量查询任务 ID；有分页时 UI 必须消费完整分页，不硬截 50 条。
- 历史列表支持时间范围、状态、类型、业务来源；按稳定的 `(created_at, id)` 游标分页。
- 当前后端传显式 statuses 可绕过 recent 窗口，因此已有部分历史查询能力；需要补的是明确入口、日期检索和稳定分页，不是宣称当前没有历史。
- 详情才读取 payload/result 和产物；列表 SQL 不选择这些大 JSON，不为每轮活动刷新计算昂贵的历史总数。
- 先统一现有轮询：有活跃任务时刷新、隐藏标签页降频、失败保留旧数据。SSE 可在实时性实测不满足时再引入，不先添加事件总线或逐事件持久化。
- 执行中断、刷新页面、Redis 清空均不应影响已落库历史。业务对象删除后仍能辨识来源；产物若按明确规则删除，应显示“文件已删除”，而非历史无故消失。
- 本次建议默认保留任务元数据与成功产物，不加自动 TTL。后续若设置存储保留期，必须同时定义产品展示和显式删除语义。

索引从真实查询开始：领取用 `(status, created_at, id)`；到期轮询用 `(status, next_poll_at, id)`；超时扫描用 `(status, deadline_at)`；历史用 `(created_at, id)`，有隔离维度时放在前缀；业务反查复用关联表索引。用 EXPLAIN 与历史数据量验证，不预先增加所有组合索引。

## 删除与保留清单

| 删除或收敛 | 必须保留的能力 |
| --- | --- |
| 任务链路的 Celery Worker、Beat、Redis broker 依赖 | 独立 Worker 隔离 API；Redis 若还有其他用途，单独核对 |
| GenerationDispatchOutbox、RunDispatch、重新投递器 | Task 的事务提交与原子领取 |
| GenerationRun / ExecutionAttempt、lease、epoch、reaper 重排队 | 一次提交领取、文本中断归档、媒体到期查询、迟到写入拒绝 |
| 独立 ProviderOperation 表、dual-read、强制恢复能力门禁 | Task 上的远端 ID/身份/查询时间，跨重启查询；缺数据直接失败；可用时的取消 |
| 独立恢复型媒体物化阶段 | 可重复安全收取、自有存储、稳定文件引用、孤儿清理、业务版本冲突保护 |
| TaskManager 空策略、占位 task 类、重复终态协调器 | 一张 handler 映射、一个 TaskService、统一终结事务、领域 service |
| 通用任务系统里的 streaming 生命周期 | 请求内 SSE 的消息历史和既有独立接口契约 |

通用 DTO 仍放 `app/core/contracts`；API 负责收参、鉴权和响应，业务 service 负责校验、交付与状态转换。分镜编辑页保持准备职责，工作室保持生成职责，`shot.status` 不承载运行时状态，任务中心不扩成业务调试页面。

## 建议实施顺序与验收

| 阶段 | 工作 | 验证 |
| --- | --- | --- |
| 1. 固定契约 | 区分文本本地执行、同步媒体请求、异步媒体跟踪；更新取消、中断、历史语义 | 不要求本地执行恢复；已受理媒体跨重启继续查询 |
| 2. 建最小执行链 | TaskService、MySQL 领取、提交与单次 poll 循环、分开并发上限 | 提交只领取一次；文本强杀后中断；媒体强杀后只继续 GET/poll，不再次 create |
| 3. 接业务与媒体 | 迁移所有任务；补稳定 key、重复收取和事务交付 | 远端完成后重启仍能保存结果；上传后 DB 回滚不重复产物；不覆盖新版业务数据 |
| 4. 历史与查询 | 轻量活动列表、日期检索、分页、稳定产物、重新提交 | 超过 50 条及跨天任务完整可查；短暂网络错误不清空；原任务不被重试覆盖 |
| 5. 切换目标模型并删除旧层 | 按四表结构实现，切新入口，移除旧执行协议与依赖 | 新旧 Worker 不同时消费；新模型的历史与产物关系完整；无旧模块导入残留 |

本轮只设计目标结构，不安排旧数据转换、旧字段兼容或双写阶段。后续实施需通过新模型的历史查询验收；本提案不构成清空实际数据库的操作。

需重点覆盖的失败场景：领取后立即崩溃；异步成功响应缺 ID；create 后 ID 未落库；远端 ID 落库后重启；轮询短暂断网；供应商已完成但本地尚未收取时重启；取消与成功同时提交；跟踪超时；上传成功但 DB 回滚；业务目标版本冲突。目标是有 ID 即可继续跟踪、缺必要数据直接失败、结果不覆盖、不自动重复生成。

性能验证使用固定假 Provider 延迟和相同机器、配额、总在途任务数，对比现有路径与候选路径：记录提交到开始 p50/p95、完成吞吐、CPU/RSS、DB 查询数与占用连接数、列表查询延迟。数据库轮询开销和高并发媒体内存必须一起测；不能用开源项目宣传的倍数代替本项目结果。

实施涉及后端 API 或状态模型时运行 `pnpm run openapi:update` 并同步 generated client；前端至少通过 `pnpm exec tsc --noEmit`，后端通过相关服务、API 和 MySQL 并发测试。当前只新增评估文档，不触发这些代码变更检查。
