# 接口与 OpenAPI

后端默认提供 `/docs` 交互式接口说明与 `/openapi.json` 机器可读契约。实际路径、参数和响应以当前工作区后端导出的 OpenAPI 为准。

| 路由范围 | 用途 |
| --- | --- |
| `/health` | 健康检查 |
| `/api/v1/studio` | 项目、章节、场次、资产、文件、实验室与生成画布 |
| `/api/v1/film` | 通用任务查询、状态、结果和取消 |
| `/api/v1/llm` | 模型与供应商配置 |

画布 MCP 在开关开启且配置了密钥时通过 `/mcp` 提供 Streamable HTTP。客户端连接后通过 `tools/list` 发现工具。接入和密钥轮换见[画布 MCP 使用指南](../../../site/content/docs/tools/generation-canvas.md#从-mcp-客户端连接画布)。

前端统一使用 `front/src/services/generated` 客户端。接口契约变化时按 [OpenAPI 同步指南](../guides/openapi.md)操作。状态语义见[任务执行架构](../architecture/task-execution.md)。

章节一致性检查与四类资产描述分析统一使用 `/api/v1/script-processing/*-async` 任务接口；对应的五个同步入口已退役。演员图片生成参数统一使用 `/api/v1/film/tasks/asset-images/{entity_type}/{entity_id}/{image_id}/parameters`，演员专用旧入口已退役。
