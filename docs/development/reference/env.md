# 环境变量

配置样例随代码维护，不在文档复制凭据。首次本地启动分别复制 `backend/.env.example`、`front/.env.example`；Compose 使用 `deploy/compose/.env.example`。

| 配置范围 | 变量 | 用途 |
| --- | --- | --- |
| 后端 | `DATABASE_URL` | MySQL 异步连接，迁移和运行需指向预期数据库 |
| 后端 | `CORS_ORIGINS` | 允许访问 API 的前端来源，逗号分隔 |
| 画布 MCP | `MCP_ENABLED`、`MCP_SECRET_KEY` | 开关默认开启。配置非空密钥后注册 `/mcp`，客户端以 Bearer 密钥访问全部画布。 |
| 对象存储 | `S3_ENDPOINT_URL`、`S3_REGION_NAME`、`S3_BUCKET_NAME`、`S3_BASE_PATH` | S3 兼容服务地址、区域、桶和对象前缀 |
| 孤儿对象扫描 | `S3_ORPHAN_CLEANUP_SCOPE` | 默认为空。仅当授权值与当前 Worker 的数据库和存储命名空间一致时才扫描。 |
| 对象存储 | `S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY` | 存储认证；本地与 Compose 配置保持一致 |
| 前端 | `VITE_BACKEND_URL` | 浏览器访问的后端地址 |
| 前端 | `VITE_USE_MOCK` | 本地真实联调使用 false |

供应商模型通过模型管理配置，已受理媒体任务使用冻结配置；修改密钥不回写旧任务。其他运行参数以配置定义和对应 `.env.example` 为准，不把样例默认凭据用于公开部署。

启动步骤见[本地开发](../guides/local-development.md)和 [Docker 部署](../../../site/content/docs/getting-started/docker.md)。

## 启用孤儿对象扫描

扫描需要显式配置 `S3_ENDPOINT_URL`，数据库连接 URL 不带查询参数。先确认数据库独占配置的桶或前缀，再使用与目标 Worker 相同的环境生成授权值。宿主机在 `backend` 目录运行 `uv run python -m app.services.file_cleanup`。Compose 在原有命令参数后运行 `run --rm --no-deps backend .venv/bin/python -m app.services.file_cleanup`。

将输出填入 `S3_ORPHAN_CLEANUP_SCOPE`，再启动 Worker。重建或恢复数据库前清空授权，即使连接地址和库名沿用原值。重新核对数据库与桶或前缀的归属后再启用。用户明确登记的删除继续按原流程处理。

隔离 MySQL 测试入口和审批重启回归会自动为测试进程配置随机存储前缀，并清空继承的扫描授权。
