---
title: "交互会话接口迁移"
date: 2026-11-26
description: "五类交互会话的统一订阅、媒体受理查询与旧路径退役说明。"
tags:
  - release
  - api
authors:
  - Jellyfish Team
---

## Changed

- 文本试模离开页面后继续执行。重新打开会话时，页面从快照恢复部分回复，再接收原轮次的后续增量和终态。需要中断运行时使用停止操作。
- 图片和视频发送回执丢失后，可按原幂等键读取原回执。查询没有可返回的受理记录时响应 404。

## Breaking Changes

以下路径均以 `/api/v1/studio` 为前缀。旧会话路径已退役，请按对应替代操作迁移。

| 退役操作 | 替代操作 |
| --- | --- |
| `POST /chat/sessions/{session_id}/turns` | `POST /chat/sessions/{kind}/{session_id}/turns` |
| `GET /chat/sessions/{session_id}/events` | `GET /chat/sessions/{kind}/{session_id}/events` |
| `POST /chat/sessions/{session_id}/turns/{turn_id}/answer` | `POST /chat/sessions/{kind}/{session_id}/turns/{turn_id}/answer` |
| `GET /chat/sessions/canvas/{id}`、`GET /chat/sessions/lab/{id}`、`GET /chat/sessions/text/{id}`、`GET /chat/sessions/media/{id}` | `GET /chat/sessions/{kind}/{session_id}/snapshot` |
| `GET /generation-canvases/{id}/assistant`、`GET /experiment-sessions/{id}/messages` | `GET /chat/sessions/{kind}/{session_id}/snapshot` |
| `GET /experiment-sessions/{id}/interaction/requests/{request_id}` | `GET /chat/sessions/{kind}/{session_id}/requests/{request_id}`，适用于图片和视频试模 |
| `POST /chat/sessions/canvas/{id}/turns/{turn_id}/stop`、`POST /generation-canvases/{id}/assistant/turns/{turn_id}/stop` | `POST /chat/sessions/canvas/{id}/turns/{turn_id}/stop/snapshot`，返回停止后的快照 |

## Migration Guide

1. 会话类型使用 `canvas`、`chat`、`text`、`image` 或 `video`。原 `lab` 快照调用改用 `chat`。原 `media` 快照调用按会话模态使用 `image` 或 `video`。
2. 文本、图片和视频发送都需要 `Idempotency-Key`。发送结果未知时，图片和视频可用同一请求身份查询原回执。任务进度和产物可从快照及 SSE 取得。
3. 打开会话时先读取快照，再将其 `cursor` 传给 SSE 的 `after` 参数。翻阅历史时继续沿用当前事件订阅。更新调用 SDK，使用应用生成的 OpenAPI 契约验证上述方法和路径。

现有会话历史经统一入口读取。旧文本运行的已知终态、画布历史续答和旧媒体受理事件仍可回放。
