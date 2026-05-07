# Explore: test-llm-model-config

本文档为 plan/tasks 阶段的事实基线。标注：[事实] / [推断] / [待确认]。

---

## 1. 前端模型管理现状

- **[事实]** `front/src/pages/aiStudio/models/ModelsTab.tsx` 中，表格行操作区「测试生成」（`ThunderboltOutlined`）的 `onClick` 仅 `stopPropagation()`，**未调用任何 API**（约 365–374 行）。
- **[事实]** 同文件卡片视图「测试生成」按钮、详情/抽屉「快速测试」按钮 **无业务 `onClick`**（约 559–560、657、690 行）。
- **[事实]** `front/src/pages/aiStudio/models/ProvidersTab.tsx` 中 `handleTestConnection` 仅 `setTimeout(800)` 后 `message.success('连接成功')`，**未请求后端**（约 141–152 行）。与「供应商测试连接已实现」的直觉不符——**当前为前端占位**。

## 2. 后端 LLM 配置与路由

- **[事实]** `backend/app/api/v1/routes/llm.py` 提供 Provider / Model / ModelSettings 的 CRUD 及 options 查询；**无**模型「验证 / 探测 / 试调用」类路由。
- **[事实]** `backend/app/main.py` 将 v1 路由挂在 `settings.api_v1_prefix`（默认 `/api/v1`），未见全局 JWT/用户依赖；**[推断]** FR-006「详情仅管理员可见」**无法**仅依赖现有后端 RBAC，需新产品约定（见 plan Notes）。

## 3. 模型解析与文本构造

- **[事实]** `backend/app/services/llm/resolver.py` 中 `_build_chat_openai_model` 根据 `Provider` + `Model` 组装 `langchain_openai.ChatOpenAI`，含 `model.name`、`api_key`、`resolve_effective_base_url`、合并 `model.params`（约 149–185 行）。
- **[事实]** `build_default_text_llm` / `get_model_by_category` 面向**默认模型**；对「任意 `model_id`」需组合 `_resolve_model` + `get_provider_by_model_or_id` + 与 `_build_chat_openai_model` 等价的构造逻辑——**[推断]** 适合抽成「按模型记录构造 Chat 实例」供验证复用，避免复制粘贴。

## 4. 供应商解析与自定义供应商

- **[事实]** `backend/app/services/llm/provider_resolver.py` 中 `resolve_provider_config_from_provider`：若 `try_resolve_provider_key_from_name(provider.name)` 为 `None`，抛出 **503**，文案含 *Custom provider has no registered task adapter*（约 62–66 行）。
- **[事实]** `resolve_provider_config_from_provider` 会校验 `ProviderStatus.disabled`、类别是否支持、`requires_api_key` 等（同文件）。
- **[推断]** **已注册的**图片/视频任务适配器与 `ProviderConfig(provider_key)` 在 `app/core/tasks/image_generation_tasks.py`、`VideoGenerationTask` 等处使用；模型验证若走「轻量 HTTP」需与 `provider_key` 分支一致。

## 5. 图片 / 视频真实调用链（供对照「探测」策略）

- **[事实]** 工作室侧图片任务最终使用 `ImageGenerationTask` + 各 provider 的 HTTP 适配器（如 `OpenAIImageApiAdapter.generate`、`VolcengineImageApiAdapter.generate`），见 `backend/app/services/studio/image_task_runner.py`、`backend/app/core/tasks/image_generation_tasks.py`。
- **[事实]** 视频类似：`VideoGenerationTask` + `OpenAI`/`Volcengine` 适配器（`backend/app/services/film/generated_video.py` 等）。
- **[推断]** Spec 要求图像/视频 **不做真实最小成片/成图**；实现上应优先 **鉴权 + 连通 + 与模型标识相关的轻量请求**（例如 OpenAI 兼容的 `GET /v1/models` 校验密钥与模型名是否在列表中），而非调用 `images/generations` / `contents/generations/tasks`。
- **[待确认]** 火山方舟（volcengine）是否存在 **不创建生成任务** 的轻量 endpoint（如模型列表/账户探测）；若无，需在 implement 阶段在 **不违背 Spec** 的前提下选定次优探测（例如极短超时 + 明确失败分类），并在 Notes 中记录风险。

## 6. 测试与 OpenAPI

- **[事实]** `backend/tests/test_llm_manage.py` 覆盖 `create_model`、`list_models_paginated` 等；**无**模型验证相关用例。
- **[事实]** 前端通过 `openapi-typescript-codegen` 从 `LlmService` 生成客户端；**新增** LLM 路由后需执行仓库约定的 `pnpm run openapi:update`（见 `README.md` / `AGENTS.md`）。

---

## 探索轮次小结

- **已定位改动面**：`llm` API 层、`services/llm` 新增验证编排、`schemas/llm` 新增响应模型、`ModelsTab.tsx`（及可选 `ProvidersTab` 真连接）、`openapi` + generated client、单测。
- **无未决方案分叉**：文本 = 极小 `ainvoke`；图像/视频 = provider 分支轻量 HTTP + 尽量校验模型名；自定义/未注册供应商沿用现有 503 语义。
- **待产品/架构补齐**：FR-006 与当前「无全局 API 用户模型」之间的差距（见 `plan.md` Notes）。
