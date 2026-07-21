---
title: "LLM 默认模型解析"
weight: 35
description: "当前生效的 LLM 默认模型来源与解析顺序。"
---

本文记录当前真实生效的默认模型规则（text / image / video）。

## 单一事实来源

- 默认模型统一由 `model_settings` 单例表维护：
  - `default_text_model_id`
  - `default_image_model_id`
  - `default_video_model_id`
- `models` 表不再承担“默认模型”语义，`models.is_default` 已下线。

## 解析规则

- 运行时按类别读取 `model_settings` 对应字段。
- 若对应默认模型 ID 未配置，服务返回 `503`（`No default model configured for category=...`）。
- 若配置了模型 ID 但模型不存在，服务返回 `503`（`Configured default model not found: ...`）。

## 管理入口

- 默认模型仍仅通过 `LLM Model Settings` 接口维护（`/api/v1/llm/model-settings`），但管理 UI 已迁入“模型”页顶部的“全局默认模型”区域。
- 模型页按 text / image / video 展示可选模型，并可独立更新各类别的默认模型；这不会修改模型实体本身。
- “运行设置”页仅维护 API 超时与日志级别，避免将全局运行参数混入单个模型配置。

## Vidu 图片与视频模型

- Vidu 是当前内置的图片、视频供应商，稳定 key 为 `vidu`，默认 Base URL 为 `https://api.vidu.cn`。
- 图片模型通过 `POST /ent/v2/reference2image` 创建异步任务；视频模型依据输入自动选择文本、单图、首尾帧或多参考图视频端点。
- 两类任务均通过 `GET /ent/v2/tasks/{task_id}/creations` 轮询结果。成功响应中的 `creations[*].url` 会立即进入既有的图片/视频资产持久化流程，因为 Vidu 返回的结果 URL 有有效期。
- Vidu 使用 `Authorization: Token <API Key>`；Provider 列表和普通详情接口不会回显 `api_key` / `api_secret`。模型管理的编辑弹窗会按需调用 `GET /api/v1/llm/providers/{provider_id}/credentials` 回填凭据，使密码框的显示/隐藏按钮能呈现真实值；该接口仅应暴露给具备供应商配置管理权限的调用方。

## 可灵图片与视频模型

- 可灵 AI 是当前内置的图片、视频供应商，稳定 key 为 `kling`，默认 Base URL 为 `https://api-beijing.klingai.com`，使用 `Authorization: Bearer <API Key>` 鉴权。
- 模型目录由后端静态维护，不调用可灵模型列表接口：`kling-3.0-turbo`（文生视频）、`kling-3.0`（文生视频与首帧/首尾帧图生视频）以及 `kling-v3`（图片生成）。
- 视频任务依模型和输入选择 `/text-to-video/kling-3.0-turbo`、`/text-to-video/kling-3.0` 或 `/image-to-video/kling-3.0` 创建，并使用 `GET /tasks?task_ids=...` 轮询；成功后的 `outputs[*].url` 进入既有视频资产归档流程。
- 图片任务通过 `POST /v1/images/generations` 创建、`GET /v1/images/generations/{id}` 轮询；成功后的 `task_result.images[*].url` 进入既有图片资产归档流程。可灵产物链接会过期，Worker 必须及时归档。
- 当前通用契约只开放可无损映射的参数；Omni 的主体库、多镜头、原生音频与图片参考类型等专属控制暂不在页面暴露。

## 供应商模型目录与导入

- 模型管理页的“添加模型”采用供应商优先流程：先选择 Provider，再选择该 Provider 支持的模型类别，最后从目录多选模型名称或手动输入名称；编辑模型仍为单条编辑。
- 目录模型和手动输入模型都通过 `POST /api/v1/llm/providers/{provider_id}/models/import` 批量导入，重复的 Provider + 类别 + 名称组合由后端幂等跳过。
- 页面通过 `GET /api/v1/llm/providers/{provider_id}/models/catalog` 获取已配置 Provider 的可导入模型目录；浏览器不会读取或传递 API Key。
- OpenAI 兼容供应商（当前 OpenAI、火山引擎）从其配置 Base URL 的 `/models` 接口实时读取模型名，并按名称规则归类为 text、image 或 video。
- Vidu 当前未提供模型枚举 API，因此该入口返回项目维护的 Vidu 官方 Model Map 目录，并在页面明确标注为“官方模型目录”。
- 可灵同样返回项目维护的固定模型目录，避免将其非标准模型接口暴露到模型管理流程。
- 用户选择后调用 `POST /api/v1/llm/providers/{provider_id}/models/import` 批量写入；同一 Provider、模型名称和类别的已有记录会跳过，不会被覆盖或重复创建。
