---
title: "LLM 供应商注册与扩展"
weight: 12
description: "如何在代码中注册内置供应商能力，并与异步任务执行器对齐。"
---

系统里与「供应商」相关的概念分两层，扩展时通常要同时考虑。

## 两层注册分别解决什么

1. **能力注册表（内置、进程内）**  
   描述「我们认识哪些供应商 key、别名、支持哪些模型类别、默认 base URL」等。  
   实现位于 `app/services/llm/provider_registry.py`，启动时通过 `app/services/llm/provider_bootstrap.py` 的 `bootstrap_builtin_providers()` 调用 `register_many(...)` 写入。  
   对外只读入口：`GET /api/v1/llm/providers/supported`（可按 `category` 过滤），供前端展示可选能力与默认值提示。

2. **任务执行器注册表（任务类型 × 供应商 key）**  
   描述「某类异步任务（如图片生成、视频生成）在某个供应商 key 上由哪个工厂函数构造执行器」。  
   实现位于 `app/core/tasks/registry.py`，启动时通过 `app/core/tasks/bootstrap.py` 的 `bootstrap_task_adapters()` 注册。  
   Worker 或内联执行路径会按任务 payload 里的供应商信息解析到具体实现。

3. **出站 HTTP 适配层（`app/core/integrations/`）**  
   OpenAI / 火山等供应商的 URL、请求体、响应解析集中在 `app/core/integrations/openai/`与 `app/core/integrations/volcengine/`（图片、视频分文件）；`ImageGenerationTask` / `VideoGenerationTask` 只做生命周期与轮询节奏，**不**直接拼 httpx 细节。  
   与任务输入输出共用的 Pydantic 模型放在 `app/core/tasks/image_generation_types.py`、`video_generation_types.py`，避免 `tasks` 与 `integrations` 循环导入。

应用启动时由 `app/bootstrap.py` 的 `bootstrap_all_registries()` **先** bootstrap供应商能力，**再** bootstrap 任务适配器，保证解析供应商 key 时注册表已就绪。

## 新增一个内置供应商时要改哪里

按顺序检查并补齐下面几项（均以「新增 key `acme`」为例）。

### 1. 能力规格在 `provider_bootstrap.py` 中为 `acme` 增加一条 `ProviderSpec`：

- `key`：稳定小写 key，与任务注册、DB 里可选的命名约定一致。
- `aliases`：兼容历史名称、中文名、常见拼写。
- `supported_categories`：`ModelCategoryKey` 中本供应商实际接得住的类别（text / image / video）。
- `default_base_url`：若 UI 或创建 Provider 时需要默认 endpoint，可填；纯网关型可置空。

若 key 或别名与已有注册冲突，`register_provider` 会抛错，避免静默覆盖。

### 2. 任务适配器

在 `app/core/tasks/bootstrap.py` 中，对每一种需要跑在 `acme` 上的任务类型调用 `register_task_adapter`，例如：

- `image_generation` + `acme` → 指向 `ImageGenerationTask` 上对应的 `_build_acme_impl`（或等价工厂）。
- `video_generation` + `acme` → 指向 `VideoGenerationTask` 上对应的工厂。

工厂未注册时，任务分派会在运行时报错，与「能力表里有 key」不是一回事：**能力表只说明「产品层面支持」；任务表说明「 worker 能执行」**。

### 3. 具体实现类

- 在 `app/core/integrations/` 下为 `acme` 增加图片/视频 API 适配类（httpx 调用与 JSON 映射）。  
- 在 `image_generation_tasks.py` / `video_generation_tasks.py` 中增加 `_build_acme_impl`，构造 Task 并注入对应 adapter（或默认 adapter）。  
- 在 `app/core/tasks/bootstrap.py` 中注册 `(task_kind, acme)` → 该工厂。  
若 `provider_resolver` 或 manage 层有按供应商分支的逻辑，按需增加分支，保持 **api 薄、service 厚**。

### 4. 验证

- 跑与 LLM 路由相关的测试（例如 `backend/tests/test_llm_api_responses.py` 中对 `providers/supported` 的断言可按需扩展）。
- 跑任务注册相关测试（如 `backend/tests/test_task_registry.py`）。
- 适配层可补充 `backend/tests/core/integrations/` 下基于 `httpx.MockTransport` 的单测，无需真实网络。
- 若暴露了新 API 或响应字段，按仓库约定执行 `pnpm run openapi:update` 并更新前端 generated client。

## 与数据库里配置的 Provider 的关系

- **内置注册表**：定义「系统认识哪些供应商 key、类别、默认 URL」，不替代数据库中的 `Provider` 实例（API Key、环境特定 base_url 等仍存 DB）。
- **用户/运维在 UI 创建的 Provider**：可以选择 `supported` 列表中的内置供应商，也可以输入自定义名称。
- **自定义 Provider**：配置阶段允许关联任意类别模型；文本模型按 OpenAI-compatible `base_url` 使用，图片/视频生成任务仍需要后续注册对应任务适配器。

### Base URL 优先级（按类别解析）

当前 `Provider` 支持三组 URL 字段：

- `base_url`：文本/通用入口（默认建议配置 OpenAI-compatible 网关）。
- `image_base_url`：图片能力覆盖入口（可选）。
- `video_base_url`：视频能力覆盖入口（可选）。

运行时解析优先级：

- image：`image_base_url` > `base_url` > `ProviderSpec.default_base_url`
- video：`video_base_url` > `base_url` > `ProviderSpec.default_base_url`
- text：`base_url` > `ProviderSpec.default_base_url`

自定义 Provider 不存在 `ProviderSpec.default_base_url`，因此只使用数据库中的 URL 字段。

## 阿里百炼图片：线下验证

图片任务走 DashScope 原生 HTTP，与兼容模式下的 Chat Completions 不是同一路径。部署或改模型后，建议先按 **[线下验证阿里百炼文生图](/docs/guide/verify-aliyun-bailian-image/)** 用脚本直连确认 Key 与模型可用，再排 Celery / 前端问题。

## 测试提示

完整 `app.main` 会加载含 Celery 依赖的路由链。仅验证 LLM 路由行为时，可使用测试辅助模块 `backend/tests/support/llm_api_app.py` 构建只挂载 `/api/v1/llm` 的应用，避免轻量环境缺少可选依赖导致导入失败。
