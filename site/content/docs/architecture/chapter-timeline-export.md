---
title: "章节时间线与导出成片"
weight: 45
description: "章节级镜头编排时间线、乐观锁保存与异步 FFmpeg 拼接导出任务。"
---

## 数据

- 表 `chapter_timeline_states`：每章一行可选状态，`layout_version` 在每次成功 `PUT` 后递增，用于与客户端 `layout_version` 对比（冲突时 HTTP 409）。
- 表 `chapter_timeline_segments`：每章内每镜至多一条，按 `position` 排序；`trim_start_ms` / `trim_end_ms` 表示**相对镜头成片文件**的裁剪毫秒坐标：**二者均为空表示全长**；否则区间为**左闭右开** `[start, end)`，缺省入点为 `0`、缺省出点为源成片时长。`PUT` 在设置任一端非空时会 **ffprobe 下载校验** 成片时长（镜头须已有 `generated_video`）。
- `FileUsageKind.chapter_master_video`：标识「章节时间线导出」产出的单一成片。

与历史 `timeline_clips`（项目级素材线）语义分离：本章时间线只绑定 `Shot`，成片文件在导出时从 `Shot.generated_video_file_id` 解析，避免与镜头成片脱节。

## API

- `GET/PUT /api/v1/studio/chapters/{chapter_id}/timeline`：读取合并「已保存顺序 + 未入线镜头按 `shot.index` 追加」；`PUT` 全量替换片段并 bump 版本（含裁剪字段校验）。
- `POST /api/v1/studio/chapters/{chapter_id}/timeline/export`：创建 `task_kind=chapter_timeline_export` 的异步任务；请求体可选 `encode_mode`（默认 `uniform_transcode`，可选 `lossless_concat_only`）。若存在同章进行中的导出任务则 409。

## 任务与 Worker

- 执行器在 `task_executor_registry` 中注册为 `chapter_timeline_export`（`AbstractAsyncDelegatingExecutor`，超时 7200s）。
- Runner **仅信任** `run_args` 中的 `chapter_id` / `encode_mode`；在库内按时间线顺序再次校验 `shot` 归属与 `FileItem`（视频类型与 `storage_key`），再下载、探测、拼接、上传，并写入 `FileUsage` 与 `GenerationTaskLink.file_id`。
- `uniform_transcode`：每段先按 `trim_*` 做 `trim`/`atrim`，再统一 H.264 + **AAC** 拼接；无音轨段用 `anullsrc` 按**裁剪后时长**补静音。`lossless_concat_only` 仍用 concat demuxer `-c copy`，**不支持实质裁剪**（任一段入出点非全长则 Runner 报错，需改 `uniform_transcode`）；若各段编码不一致同样需改走统一转码。
- 生产镜像在 `deploy/docker/backend.Dockerfile` 中安装 `ffmpeg`（含 `ffprobe`），与 API/Worker 共用镜像时需保证容器内可调用。

## 前端

- 路由：`/projects/:projectId/chapters/:chapterId/timeline`；OpenAPI 生成 `StudioChaptersService` 对应方法。
- 剪辑页提供片段级入出点编辑、**顺序预览**（按时间线顺序在单播放器内衔接播放，尊重裁剪区间），以及导出入口。
- 任务中心仍只展示通用任务信息；导出结果通过任务轮询/文件库消费，业务说明留在剪辑页。

## 与产品边界

- 分镜编辑页/分镜工作室职责不变；「章节剪辑」仅负责章节内镜头顺序与导出成片，不承载分镜提取确认主流程。
