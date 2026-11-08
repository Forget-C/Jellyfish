# 运行与排查异步任务

## 核对运行进程

按[本地开发](local-development.md)或 [Docker 部署](../../../site/content/docs/getting-started/docker.md)说明准备数据库、对象存储和配置。已有数据库按[升级指南](database-upgrade.md)核对版本及种子，再启动 API 和独立 Worker。

一个数据库只运行一个调度 Worker。更新 Worker 代码时，确认旧进程已停止，再启动当前工作区的进程。API 热重载不会更新独立 Worker。运行方式和并发边界见[任务执行架构](../architecture/task-execution.md)。

## 查询状态和结果

前端通过 OpenAPI generated client 调用任务接口：

| 入口 | 用途 |
| --- | --- |
| `GET /api/v1/film/tasks` | 按状态、类型、目标、项目和日期筛选，游标分页 |
| `GET /api/v1/film/tasks/{task_id}/status` | 查询状态、进度、阶段和耗时 |
| `GET /api/v1/film/tasks/{task_id}/result` | 查询结果、错误与媒体文件 |
| `GET /api/v1/film/tasks/outputs` | 查询业务候选文件历史 |
| `POST /api/v1/film/tasks/{task_id}/cancel` | 请求取消活动任务 |

用业务入口查看提示词、参考图分组或成果采用状态。已受理媒体任务使用固定配置，包括处于排队状态的任务。明确重新提交时，新的任务按当前配置受理。

## 按现象排查

1. **一直排队**。核对数据库迁移版本、Worker 是否运行和可用并发。开发环境可用 `uv run python -m app.dev status` 核对进程身份与代码指纹。
2. **长时间运行**。查看 Worker 日志和任务阶段。`polling` 表示仍在查询供应商，`saving` 表示正在收取结果。远端完成后仍需保存输出和处理交付。
3. **重启后失败**。已有远端 ID 的媒体继续查询同一个 ID。没有远端 ID 的中断生成需要用户明确重新提交。缺少有效冻结配置的旧活动媒体任务也需重新提交。
4. **缺少结果或输入**。查看错误码，修正凭据、地址、输入文件或其他配置后，从业务入口重新提交。可用 `uv run python -m app.dev task <task_id>` 在开发环境做只读诊断，具体输出见本地开发指南。
5. **文件删除冲突**。先解除实际使用关系或等待活动任务结束。文件字节由后台清理，任务历史仍可查阅。

排队任务请求取消后立即终结。运行任务先登记意图，由统一终结规则处理。已发送的请求和供应商计费按供应商实际情况判断。
