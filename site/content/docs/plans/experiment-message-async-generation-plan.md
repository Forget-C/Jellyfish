---
title: "实验室消息与异步生成任务收口计划"
description: "明确 ExperimentMessage 与 GenerationTask 的边界，移除模型配置 revision，并为未来重放保留任务参数快照。"
weight: 46
status: in_progress
---

## 目标

统一实验室的用户可见历史，同时保持同步文本对话和异步任务的职责边界：

```text
文本实验室 SSE
ExperimentSession → ExperimentMessage

图片 / 视频实验室
ExperimentSession → ExperimentMessage(task_id) → GenerationTask

分镜、资产、脚本等异步入口
GenerationTask
```

- `ExperimentMessage` 是实验室内所有用户可见对话的权威时间线。
- `GenerationTask` 仅是异步执行记录：保存参数、状态、错误、进度和产物。
- 模型配置不做历史冻结；Worker 使用执行时的当前模型配置和最新 Provider 密钥。
- 当前不实现任务重放 API；任务参数快照仅作为未来重放的输入基础。

## 已确认的语义

### 文本 SSE 对话

文本实验室的用户消息和助手流式消息都直接写入 `ExperimentMessage`：

- 不创建 `GenerationTask`；
- 不进入任务中心；
- 重新进入会话时，只依赖消息历史恢复展示；
- 对话续聊依赖会话消息上下文，不属于异步任务重放。

### 图片与视频异步生成

实验室提交图片或视频时，服务端必须在一个事务中完成：

1. 写入用户发起生成的 `ExperimentMessage`；
2. 创建 `GenerationTask` 并写入完整 `request_snapshot`；
3. 写入 `role=task` 的 `ExperimentMessage`，关联其 `task_id`。

Worker 以 `GenerationTask` 为执行真相源，完成、失败或取消时将用户可见的摘要、错误和产物引用投影回对应任务消息。因此实验室历史不依赖临时轮询结果才能完整恢复。

### 模型与 Provider

任务快照仅保存用户提交的 `model_id`、提示词、媒体和 operation 参数，不保存 API Key、端点或模型配置副本。

- Provider 密钥更新后，Worker 自动使用最新密钥；
- 待执行任务不因模型配置变化而阻塞，执行时使用当前模型配置；
- 模型不存在、类别不匹配或 Provider 被禁用时，Worker 将任务置为明确失败状态；
- 不再维护 `ModelConfigRevision`、`current_revision_id` 或 `model_revision_id`。

## 数据职责

### 强制数据真相约束

以下两条为本计划的不可变约束：

1. `GenerationTask.request_snapshot` 是异步任务参数的唯一权威来源。Worker 必须只消费任务快照，`ExperimentMessage.payload` 只能用于展示投影，不得作为执行输入或重放输入。
2. `GenerationTask` 是任务状态、错误、执行结果与产物引用的权威来源。`ExperimentMessage` 只保存用户可见摘要和产物展示引用；Worker 完成后必须将这些可见信息投影回关联消息，保证会话历史脱离临时轮询结果仍可完整恢复。

### ExperimentMessage

保留消息顺序、角色、可见正文、展示状态、`task_id` 和轻量展示 payload。

- `task_id` 只用于异步任务消息；
- 图片/视频任务消息可保存缩略图、产物引用和用户可见摘要；
- 完整执行参数不再以消息 payload 为权威来源；
- 消息读取是实验室会话恢复的唯一对话来源。

### GenerationTask

保留或规范下列异步执行数据：

```text
task_id
task_kind / modality / operation
target / source_kind
request_snapshot
status / progress / error
result / artifact refs
```

`request_snapshot` 覆盖 `model_id`、最终提示词、媒体引用、比例、seed 与强类型 operation input；Worker 不依赖实验室消息也必须可以执行任务。

分镜、资产和脚本等没有实验室会话的入口只创建 `GenerationTask`；任务中心继续仅展示通用状态、取消和回跳入口，不展示提示词或媒体调试细节。

## 实施阶段

### P0：基础迁移与审计

1. 清点所有 `ModelConfigRevision`、`current_revision_id`、`model_revision_id` 的读取和写入点。
2. 修复异步基础表的时间默认值，覆盖 `generation_dispatch_outbox`、`generation_task_media_references` 和 `generation_artifacts`；该问题与 revision 移除无关，必须独立修复。
3. 审计未完成的旧任务，并定义其终止或按当前模型重试策略；不伪造历史 revision。

### P1：简化异步执行模型

1. Generation Gate 只校验模型、Provider、目标和媒体，不再解析 revision。
2. 提交器、Outbox、Worker 只持久化和消费任务参数快照。
3. Worker 在执行时读取当前 Model/Provider，使用当前配置与最新密钥。
4. Model / Provider 更新不再隐式创建配置版本；空 PATCH 为纯 no-op。

### P2：收口实验室消息与任务投影

1. 图片、视频实验室统一采用“用户消息 + 任务 + 任务消息”的原子创建流程。
2. 任务状态和最终结果由 Worker 投影回关联消息。
3. 文本 SSE 保持独立消息路径，不创建伪任务。
4. 删除实验室消息中重复的任务参数权威存储，前端展示改为按 `task_id` 读取任务或使用已投影结果。

### P3：清理 revision 结构

在新执行链稳定、旧任务处理完成后：

1. 删除任务中的 revision 引用；
2. 删除 `models.current_revision_id`；
3. 删除 `model_config_revisions` 及相关索引、测试 fixture 与服务代码；
4. 同步 OpenAPI、前端 generated client 与架构文档。

采用“先停止使用、后删除结构”的两步发布，避免部署期间新旧 Worker 和 API 互相不兼容。

## 未来重放（不在本期实现）

异步任务重放时，读取原 `GenerationTask.request_snapshot` 并创建新的任务；模型、媒体或目标当前不可用时提示用户修正后再提交。原任务不修改，也不尝试恢复旧密钥或旧模型配置。

文本实验室的“继续对话”保持基于 `ExperimentSession` 与 `ExperimentMessage`，不复用异步任务重放机制。

## 验收标准

- SSE 文本消息不会创建 `GenerationTask`，也不出现在任务中心。
- 实验室图片/视频的每条任务消息均关联 `task_id`。
- 任务完成后重新进入会话，消息历史可直接展示终态和产物入口。
- `GenerationTask.request_snapshot` 足以脱离 `ExperimentMessage` 被 Worker 执行。
- Provider 密钥更新后，待执行任务使用最新密钥。
- Model / Provider PATCH 不再创建 revision 或产生批量版本写入。
- 分镜、资产、实验室与任务中心的职责边界不混淆。
