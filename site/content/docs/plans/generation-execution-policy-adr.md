---
title: 生成执行策略 ADR
description: 固化 inline、SSE streaming 与 durable async 的边界，以及当前 Provider 恢复能力矩阵。
status: accepted
---

## 决策

执行策略按交付语义与恢复承诺划分，而不是按文本、图片或视频模态划分。

| 策略 | 当前承诺 | Task / Attempt | 适用入口 |
| --- | --- | --- | --- |
| `inline` | 请求内完成；不承诺后台恢复 | 不创建 | 文本实验室 `/execute`、非 `-async` 脚本兼容入口 |
| `streaming` | 请求内 SSE；断线即取消；不承诺跨进程恢复 | 不创建 durable Task/Attempt | 文本实验室 `/stream` |
| `durable_async` | 可轮询、可重投递、可恢复的后台执行 | 创建 Task + Attempt | 图片、视频、后台 `text_chat`、所有 `*-async` 脚本 |

当前 SSE 入口固定为请求内短流：
`POST /api/v1/studio/labs/text/sessions/{session_id}/stream`。

- 只在内存中保存输入与事件缓冲；进程重启后不可恢复。
- 客户端断开时取消本地协程，原因记为 `client_disconnected`。
- 进程内 sequence replay 仅用于当前进程，不构成断线续传或跨进程重连承诺。
- 不创建 `GenerationTask`，不进入任务中心。

若未来需要断线续传、后台继续或可靠最终交付，必须新增独立的 hidden durable
Attempt；SSE 仅作为该 Attempt 的事件传输层。不得把当前短流描述为 hidden durable
stream，也不得让同一路由按 body 动态返回 JSON、SSE 或任务轮询响应。

## 后台任务分类

- `image_generation`、`video_generation`：`durable_async`，已使用图片/视频
  `GenerationRun` 生命周期。
- `text_chat` 的 `/tasks`：`durable_async`，已接入通用 Attempt；文本 Driver 只调用模型，
  DeliveryHandler 在 fencing 后投影任务消息与助手消息。
- `script_divide`、`script_extract`、`script_merge`、`script_consistency`、
  `script_variant`、`script_character_portrait`、`script_prop_info`、
  `script_scene_info`、`script_costume_info`、`script_optimize`、
  `script_simplify` 的 `-async` 入口：`durable_async`，仍待迁入通用 Attempt。
- 非 `-async` 脚本接口：`inline` 兼容/调试入口；后续 P4 必须逐项确定保留期限或删除。

## Provider capability matrix

仅记录项目代码已验证的能力；`unknown` 不表示供应商一定不支持。

| Provider | 图片 | 视频 | 已验证远端取消 | create 幂等 / client-key lookup |
| --- | --- | --- | --- | --- |
| OpenAI | 同步、无可恢复 ID、无 poll | 异步、有 ID、可 poll | 未实现 | unknown |
| Volcengine | 同步、无生命周期 poll | 异步、有 ID、可 poll | 未实现 | unknown |
| Vidu | 异步、有 ID、可 poll | 异步、有 ID、可 poll | 未实现 | unknown |
| Kling | 异步、有 ID、可 poll | 异步、有 ID、可 poll | 未实现 | unknown |

因此：已持久化远端 ID 的任务可以恢复 poll；create 请求结果不确定时，任何 Provider
都不得自动重发 create，必须进入后续 `create_uncertain` 状态机。同步图片不可伪造
异步 poll/checkpoint 恢复语义。

## 与既有文档的关系

`architecture/text-generation-lab.md` 与 `architecture/task-execution.md` 对当前短流
的描述保持有效。`plans/unified-generation-orchestration-plan.md` 中 hidden durable
SSE 是未来方案，不是当前实现；后续实现前必须先新增持久化 Attempt、事件保留、权限、
lease/reaper 和重连语义。

## 验收

- 每个新增生成入口必须声明 execution policy。
- API 契约不得动态切换不同交付形态。
- 后台任务必须走 durable dispatch；短流不得进入任务中心。
- 仅按此矩阵启用恢复、自动重试和远端取消能力。
