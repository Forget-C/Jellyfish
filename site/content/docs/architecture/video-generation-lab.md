---
title: 视频生成实验室
description: 独立视频模型、提示词与关键帧的调试架构。
---

# 视频生成实验室

视频生成实验室独立于项目、资产与分镜生产流程。它用于验证已登记的视频模型、`video_prompt` 提示词模板，以及首帧、尾帧和关键帧对视频生成结果的影响。

## 页面与共享组件

页面复用文本和图片实验室的 `ExperimentLabLayout`、`ExperimentComposer`、`ExperimentOptionBar`、`ExperimentPromptEditor` 与空历史提示组件。生成历史使用用户提示词气泡和视频任务气泡：任务气泡会展示状态、进度、失败原因及完成后的内嵌视频预览。

关键帧为三个具名槽位，而不是无类型图片列表：

- 首帧：`first_frame_file_id`
- 尾帧：`last_frame_file_id`
- 关键帧：`key_frame_file_id`

每个槽位均可通过同一入口上传图片或从资料库选择，选择后在入口右侧展示缩略图。这样可以保证供应商收到稳定的首帧、尾帧、关键帧顺序。

## 任务接口与执行

请求使用 `POST /api/v1/studio/video-lab/tasks`，提交已登记的视频模型 ID、提示词、画幅比例和三个可选帧文件 ID。接口会验证模型类别为 `video`，将图片文件转换为 data URL，并创建通用的 `video_generation` 异步任务；任务关联类型为 `video_lab`，不会读取或回写任何 `Shot`。

任务结果通过 `GET /api/v1/film/tasks/{task_id}/result` 轮询。成功成片会下载并归档到全局资料库，任务结果同时返回 `file_id` 和供应商视频 URL；前端优先使用资料库下载地址播放。

## 与分镜视频生成的边界

- 视频实验室：独立验证模型、提示词和关键帧，不绑定镜头，不更新分镜状态。
- 分镜工作室：生成前需要镜头、时长、准备度和项目上下文，成功后会回写镜头的生成视频。
