---
title: "LLM 默认模型解析"
weight: 35
description: "当前生效的 LLM 默认模型来源与解析顺序。"
---

本文记录当前真实生效的默认模型规则（text / image / video）。

## 单一事实来源

- 默认模型统一由 `model_settings` 单例表维护：
  - `default_text_model_id`
  - `fallback_text_model_id`
  - `default_image_model_id`
  - `default_video_model_id`
- `models` 表不再承担“默认模型”语义，`models.is_default` 已下线。

## 文本失败回退

- `fallback_text_model_id` 表示默认文本模型失败后统一升级到的回退模型，`null` 表示关闭回退。
- 策略固定为“主模型最多失败 1 次 -> 回退模型最多 1 次”，不循环、不反向。
- 触发回退的错误：超时、连接失败、HTTP 429/5xx、服务过载、空输出、JSON 解析失败、Pydantic 校验失败。
- 不回退的错误：鉴权失败、非法请求、内容拒绝/过滤、取消、其他 4xx。
- 实现上，`FallbackChatModel` 包装主/回退模型，`AgentBase` 在解析阶段再兜底一次；所有 text 任务统一生效，不按 Agent 单独配置。
- 未配置回退模型或回退模型缺失时，仅使用默认文本模型，不阻断主流程。

## 解析规则

- 运行时按类别读取 `model_settings` 对应字段。
- 若对应默认模型 ID 未配置，服务返回 `503`（`No default model configured for category=...`）。
- 若配置了模型 ID 但模型不存在，服务返回 `503`（`Configured default model not found: ...`）。

## 管理入口

- 默认模型仅通过 `LLM Model Settings` 接口维护（`/api/v1/llm/model-settings`）。
- 模型列表（`/api/v1/llm/models`）仅维护模型实体信息（名称、类别、供应商、参数等），不再提供默认切换语义。
