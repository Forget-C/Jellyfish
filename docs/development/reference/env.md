# 环境变量

配置样例随代码维护，不在文档复制凭据。首次本地启动分别复制 `backend/.env.example`、`front/.env.example`；Compose 使用 `deploy/compose/.env.example`。

| 配置范围 | 变量 | 用途 |
| --- | --- | --- |
| 后端 | `DATABASE_URL` | MySQL 异步连接，迁移和运行需指向预期数据库 |
| 后端 | `CORS_ORIGINS` | 允许访问 API 的前端来源，逗号分隔 |
| 对象存储 | `S3_ENDPOINT_URL`、`S3_REGION_NAME`、`S3_BUCKET_NAME` | S3 兼容服务地址、区域与 bucket |
| 对象存储 | `S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY` | 存储认证；本地与 Compose 配置保持一致 |
| 前端 | `VITE_BACKEND_URL` | 浏览器访问的后端地址 |
| 前端 | `VITE_USE_MOCK` | 本地真实联调使用 false |

供应商模型通过模型管理配置，已受理媒体任务使用冻结配置；修改密钥不回写旧任务。其他运行参数以配置定义和对应 `.env.example` 为准，不把样例默认凭据用于公开部署。

启动步骤见[本地开发](../guides/local-development.md)和 [Docker 部署](../../../site/content/docs/getting-started/docker.md)。
