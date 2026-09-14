---
title: "运行与排查异步任务"
description: "启动独立 Worker，查询任务历史、请求取消并排查生成失败。"
weight: 8
---

## 启动任务服务

先准备 MySQL 与对象存储，并配置 backend/.env。使用 Compose 时，迁移和系统种子服务成功后，API 与 task-worker 才启动。开发环境分开运行时，在 backend 目录执行：

```bash
uv run python -m app.scripts.migrate_database
uv run python -m app.scripts.seed_system_data
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

另开终端启动一个 Worker：

```bash
cd backend
uv run python -m app.task_worker
```

不要同时运行多个 Worker 调度进程；也不要与旧 Celery Worker 混跑。现有数据库升级要求见 [数据库迁移与系统种子](../../architecture/database-migrations/)。

## 提交与查看

从业务页面发起生成，接口返回 task_id。前端使用 OpenAPI generated client 查询：

- `GET /api/v1/film/tasks`：任务列表，按状态、类型、项目、日期筛选并使用游标翻页。
- `GET /api/v1/film/tasks/{task_id}/status`：轻量状态、进度、耗时。
- `GET /api/v1/film/tasks/{task_id}/result`：结果、错误与媒体文件。
- `GET /api/v1/film/tasks/outputs`：业务候选文件历史。

任务中心的“历史”窗口提供筛选、翻页及来源回跳。关闭页面不会停止供应商生成；重开后从任务表读取状态。来源已删除时，历史仍保留，但没有回跳入口。

异步信息提取接口每次创建新任务都执行生成，不传 refresh_cache；同章节已有活动任务时可返回其 ID。同步提取接口才有缓存刷新选项。

## 取消与重新提交

任务中心的取消操作调用 `POST /api/v1/film/tasks/{task_id}/cancel`。queued 任务立即取消；running 任务先记录取消意图，执行器在检查或终结时处理。取消不能保证供应商停止计费或已发出的同步请求立刻中断。

失败或中断后从业务入口重新提交，创建新任务，不复写旧任务。已有供应商 ID 的远端任务重启后继续查询同一个 ID；没有 ID 的中断请求直接失败，不自动重新发起生成。

## 排查顺序

1. 检查 `alembic current` 是否对应当前代码；不要通过 stamp head 掩盖缺表。
2. 确认只启动一个 task-worker，查看其执行日志。
3. 任务长期 queued 时检查 Worker 是否启动、数据库连接及容量是否被占满。
4. running / polling 表示等待供应商；running / saving 表示正在收取结果，不能仅凭供应商成功就断言本地成功。
5. 失败时查看任务结果中的错误码。缺少供应商 ID、输入文件或必需响应数据时，修正配置或输入后重新提交。
6. 文件删除返回冲突时，先解除业务采用关系或等待活动任务终结。文件字节由后台清理，任务历史记录保留。

输入提示词、参考图分组等业务细节在对应业务面板查看，不把任务中心作为提示词调试界面。实现细节见 [任务执行架构](../../architecture/task-execution/)。
