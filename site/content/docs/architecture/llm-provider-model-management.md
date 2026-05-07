---
title: "LLM 供应商与模型管理"
weight: 34
description: "当前生效的供应商配置、内置能力注册与自定义供应商模型关联规则。"
---

本文记录模型管理页与后端 LLM 管理接口当前真实生效的供应商规则。

## 供应商来源

- `Provider` 数据库存储环境级供应商配置，包括名称、通用 `base_url`、图片/视频覆盖 URL、密钥、状态与说明。
- `/api/v1/llm/providers/supported` 只返回系统内置能力清单，用于前端提示默认 Base URL 与已知类别能力。
- 模型管理页允许创建自定义供应商名称；自定义供应商不会写入内置能力注册表。

## 模型关联

- 已知供应商仍按内置能力清单校验模型类别；火山引擎（`volcengine`）与阿里百炼（`aliyun_bailian`）内置均为 **text + image + video**。其中火山文本与阿里文本都走兼容 Chat Completions；阿里图片与视频出站分别走 DashScope 原生 HTTP 适配，而非一律等同 OpenAI Images/Videos。
- 自定义供应商在配置阶段允许关联任意 `text` / `image` / `video` 类别模型。
- 模型列表的供应商下拉会显示已知供应商和自定义供应商；按类别过滤时，自定义供应商保持可选。

## 运行时边界

- 文本模型使用 OpenAI-compatible `ChatOpenAI` 构造路径，自定义供应商通过 `base_url` 接入。
- 图片/视频异步生成仍依赖 `task_kind × provider_key` 的内置任务适配器注册表。
- 阿里百炼图片生成：`provider_key=aliyun_bailian` 注册为与 OpenAI 相同的图片任务工厂，出站请求形态与 `OpenAIImageApiAdapter` 一致，`base_url` 默认为 DashScope **兼容模式** 域名（可按需在 Provider 上配置 `image_base_url` 覆盖）。
- 阿里百炼视频生成：`provider_key=aliyun_bailian` 出站走 DashScope 原生 `video-generation/video-synthesis` 异步任务（`DashScopeVideoApiAdapter`），而非 OpenAI-compatible `/videos`。默认视频模型名称需与能力匹配：**文生视频**（名称通常含 `t2v` / `text-to-video`）不应附带帧图 `media`；**图生视频 / 首尾帧（kf2v）**（名称需明确含 `i2v`、`kf2v`、`img2video`、`image-to-video` 等）在有关键帧/首尾帧时在 `input.media` 中按模型文档使用 **`type`=`first_frame` / `last_frame`**（不得使用已废弃的 `reference_image`）；名称无法识别的模型按**文生视频**处理（不传帧图 `media`）。**参考视频 / V2V** 类模型需要在 `media` 中提供视频类条目（公网视频 URL），当前分镜链路若仅有帧图无法调用，应在模型管理中改用 t2v/i2v/kf2v 等模型。
- 自定义图片/视频供应商可以先完成配置与模型绑定；真正执行生成前，仍需要注册对应任务适配器。
- 当默认图片/视频模型绑定自定义供应商时，生成参数选项接口返回保守兜底值，避免能力清单缺失导致配置页不可用。

## Base URL 解析

- text：`base_url` > 内置 `ProviderSpec.default_base_url`
- image：`image_base_url` > `base_url` > 内置 `ProviderSpec.default_base_url`
- video：`video_base_url` > `base_url` > 内置 `ProviderSpec.default_base_url`
- 自定义供应商没有内置默认 URL，因此只使用数据库中的 URL 字段。

## 模型配置验证（模型管理）

- 前端在模型列表、卡片与详情中提供「测试生成 / 快速测试」入口，调用 `POST /api/v1/llm/models/{model_id}/verify`。
- 接口为**同步**探测：不创建任务中心任务、不触发真实图片/视频成片；响应体为统一 `ApiResponse`，`data` 为 `ModelVerifyRead`（`ok`、`category`、`message`、`elapsed_ms`、可选 `detail`）。
- **文本**：使用已保存模型与供应商构造 `ChatOpenAI`，发起极小对话请求（`max_tokens` 受限）。
- **图像 / 视频**：在解析 `provider_key` 与 Base URL 后，对 `{base}/models` 发起 `GET`（Bearer），校验 HTTP 状态，并在返回的模型列表中查找与当前模型**名称**一致的条目；不要求调用 `images/generations` 或视频任务创建接口。
- `detail` 仅包含脱敏字段（如 `provider_key`、`model_name`、上游 `http_status`、短摘要等），**不得**包含 API Key 明文。当前后端无统一 RBAC 时，`detail` 仍受此约束；后续若引入「仅管理员可展开详情」的权限，可在不改动字段形状的前提下收紧服务端填充策略。

## 文本模型试聊（调试）

- 模型管理页增加「试聊」标签：选择**文本生成**类已保存模型后，可多轮输入消息；前端调用 `POST /api/v1/llm/models/{model_id}/chat-test`，请求体 `{ "message": "..." }`。
- 服务端按模型记录构造 `ChatOpenAI` 并调用上游完成回复（有单次超时与 `max_tokens` 上限）；**图/视频模型**调用该接口会返回 400。
- 试聊不计入任务中心的异步生成任务，仅供接入调试；仍会产生上游 API 调用费用。
