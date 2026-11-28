# LLM 供应商注册与扩展

内置能力注册表描述供应商 key、别名、模型类别和默认地址。API 与独立 Worker 均使用 `bootstrap_all_registries()` 注册能力；`GET /api/v1/llm/providers/supported` 可按类别查询。数据库中的 Provider 保存用户配置，与内置能力定义分别维护。

## 新增内置供应商

1. 在 `app/services/llm/provider_bootstrap.py` 声明 `ProviderSpec`。使用稳定小写 key，声明别名、实际支持的模型类别、认证要求与可用的默认地址。与已有 key 或别名冲突时，注册会报错。
2. 对图片与视频能力，核对 `app/core/contracts/provider.py` 中的 `ProviderKey`、类别能力解析、模型目录和提交前校验。只声明能映射到公共输入契约的选项。
3. 按操作登记适配器。文本调用和模型目录在 `app/core/integrations/model_provider_registry.py` 显式绑定，媒体任务在 `app/core/integrations/media_provider.py` 绑定执行适配器。独立 Worker 通过公共异步协议执行一次提交或按原远端 ID 查询。对齐认证、地址、请求映射、返回状态与结果提取，保留提交一次及查询已有任务的执行边界。
4. 使用 LLM 路由、解析和媒体供应商测试验证扩展。媒体适配可使用 HTTP 测试传输验证请求及响应映射；对外接口契约变化时按 [OpenAPI 同步指南](openapi.md)更新生成客户端。

## 与数据库里配置的 Provider 的关系

- **内置注册表**：定义「系统认识哪些供应商 key、类别、默认 URL」，不替代数据库中的 `Provider` 实例（API Key、环境特定 base_url 等仍存 DB）。
- **供应商配置**保存从支持清单选定的 `provider_key`、自定义配置名称、地址和凭据。模型通过配置 ID 绑定，执行时按 `provider_key` 选择适配器。每个供应商可以添加多份配置，同一供应商内的配置名称忽略首尾空格和英文大小写判重。

### 配置 Vidu

在模型管理中创建 Provider 时，选择供应商 Vidu，将配置命名为「视频生产」等便于识别的名称，确认预填的 `base_url` 为 `https://api.vidu.cn`，并将 Vidu API Key 填入 `api_key`。随后分别创建图片、视频模型并关联该 Provider：

- 图片：使用 Vidu 文档支持的图片模型名，例如 `viduq2` 或 `viduq1`；`viduq2` 支持纯提示词和 0–7 张参考图。
- 视频：填写所选 Vidu 视频模型名，例如 `viduq2`、`viduq3` 系列。运行时会按输入选择 `text2video`、`img2video`、`start-end2video` 或 `reference2video`，无需在模型参数中填写端点。
- 按图片或视频类别配置默认模型后，相应生成入口可使用该配置。Vidu 不支持项目通用 `watermark` 参数；带该参数的请求会在调用前被拒绝，避免静默丢参。

### 配置可灵 AI

在模型管理中创建 Provider 时，选择供应商「可灵 AI」，填写配置名称，并将 API Key 填入 `api_key`；默认 Base URL 为 `https://api-beijing.klingai.com`，通常无需覆盖。可灵当前只登记图片与视频模型：

- 视频：`kling-3.0-turbo`（仅文生视频）或 `kling-3.0`（文生、首帧与首尾帧图生视频）。
- 图片：`kling-v3`（Kling Image 3.0 Omni）。

模型列表由服务端维护的官方目录提供，刷新目录时不会调用可灵 `/models`。不要把可灵的专属多镜头、主体库或原生音频参数填入通用模型配置；当前页面只提交项目统一契约能够无损映射的字段。

### 从供应商目录添加模型

在“模型管理 → 模型”点击“添加模型”，选择已配置的供应商与类别，再从目录多选或手动输入名称。提交时，后端跳过同一供应商下已有的同名、同类别模型。

- OpenAI 兼容 Provider 使用其 `/models` API 实时读取目录，需确保 Provider 的 Base URL 与 API Key 有列举模型的权限。
- Vidu 当前没有公开模型列表 API，页面会显示从其官方 Model Map 维护的目录，并明确标记为官方目录；更新 Vidu 支持模型时应同步更新 `app/core/integrations/model_catalog.py` 与本说明。
- 可灵同样使用后端维护的固定目录；更新其支持范围时应同步调整 `app/core/integrations/model_catalog.py`、可灵能力矩阵与本说明。

### 声明模型能力

在模型编辑抽屉按操作填写声明。普通文本支持流式、工具与结构化输出等能力字段。图片模式可限制画幅、尺寸、分辨率档位和数量。视频模式可为各分辨率配置时长，例如 `{"720p":{"min_seconds":5,"max_seconds":15},"1080p":[5,10]}` 表示 720p 接受 5～15 秒（含端点），1080p 接受 5 或 10 秒。有效能力也受接入适配器的范围约束。同名模型的声明随各自供应商配置保存。

### Base URL 优先级（按类别解析）

当前 `Provider` 支持三组 URL 字段：

- `base_url`：文本/通用入口（默认建议配置 OpenAI-compatible 网关）。
- `image_base_url`：图片能力覆盖入口（可选）。
- `video_base_url`：视频能力覆盖入口（可选）。

运行时解析优先级：

- image：`image_base_url` > `base_url` > `ProviderSpec.default_base_url`
- video：`video_base_url` > `base_url` > `ProviderSpec.default_base_url`
- text：`base_url` > `ProviderSpec.default_base_url`

火山引擎使用 Ark v3 时，`base_url` / `image_base_url` 应配置为
`https://ark.cn-beijing.volces.com/api/v3`。图片生成固定请求
`/api/v3/images/generations`；不要将视频专用的 `/contents/generations` 写入图片 Base URL。
运行时会兼容已保存该历史误配的配置并自动规范化，但应在供应商编辑页中改回 v3 根地址。

## 测试提示

完整应用会加载全部业务路由。仅验证 LLM 路由时，可使用 `backend/tests/support/llm_api_app.py` 构建只挂载 `/api/v1/llm` 的测试应用；当前任务执行使用独立 Worker。
