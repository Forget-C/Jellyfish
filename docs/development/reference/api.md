# 接口与 OpenAPI

后端默认提供 `/docs` 交互式接口说明与 `/openapi.json` 机器可读契约。实际路径、参数和响应以当前工作区后端导出的 OpenAPI 为准。

| 路由范围 | 用途 |
| --- | --- |
| `/health` | 健康检查 |
| `/api/v1/studio` | 项目、章节、场次、资产、文件、实验室与生成画布 |
| `/api/v1/film` | 通用任务查询、状态、结果和取消 |
| `/api/v1/llm` | 模型与供应商配置 |

前端统一使用 `front/src/services/generated` 客户端。接口契约变化时按 [OpenAPI 同步指南](../guides/openapi.md)操作。状态语义见[任务执行架构](../../../site/content/docs/architecture/task-execution.md)。
