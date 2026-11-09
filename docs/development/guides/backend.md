# 后端说明

后端位于 `backend/`，使用 FastAPI、SQLAlchemy、LangChain 和 LangGraph。

| 目录 | 职责 |
| --- | --- |
| `app/main.py`、`app/api/v1/` | 应用入口和路由。路由负责接收参数、鉴权和组织响应。 |
| `app/services/` | 业务逻辑、数据编排与状态流转。 |
| `app/models/`、`app/schemas/` | ORM 模型与请求响应模型。 |
| `app/chains/agents/` | Agent 与提示词，业务编排由服务层负责。 |
| `app/core/contracts/`、`app/core/integrations/` | 共享生成契约与供应商协议适配。 |

## 路由与服务

- `studio` 提供项目、章节、场次、资产、文件、实验室与生成画布接口。场次业务位于 `services/directing`，生成画布位于 `services/generation_canvas`。
- `llm` 管理供应商、模型及设置；`film` 提供生成任务查询、结果和取消。
- `script-processing` 提供脚本处理与提取。
- `services/common` 存放通用校验、CRUD 和错误文案；`services/generation` 承接生成提交、输入准备及结果交付。详见 [AI 工作流](../architecture/ai-workflow.md)。

## 响应与测试

JSON 业务接口使用 `ApiResponse`，按语义选择 `created_response`、`success_response`、`empty_response` 或 `paginated_response`。流式与附件端点遵循各自响应约定，见 [OpenAPI 同步指南](openapi.md)。

在后端目录运行 `uv run pytest -q` 可执行测试。局部变更可先运行受影响的接口响应或服务层用例。启动步骤见[本地开发](local-development.md)。
