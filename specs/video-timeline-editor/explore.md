# 探索记录：章节视频剪辑与时间线导出

**Workspace**: `video-timeline-editor` | **Date**: 2026-05-06

---

## 1. 与 Spec 相关的现状

### [事实] 分镜成片来源

- 镜头表 `Shot` 含 `generated_video_file_id`，外键关联 `files.id`，ORM 见 `app/models/studio_shots.py` 中 `Shot.generated_video_file_id` 与 `generated_video_file` 关系。
- 视频生成任务完成后写回 `shot.generated_video_file_id` 并创建 `FileUsage`（`usage_kind=generated_video`），逻辑在 `app/services/film/generated_video.py` 的 `persist_generated_video_to_shot`。

### [事实] 时间线表与 API 壳

- ORM `TimelineClip` 定义于 `app/models/studio_prompts_files_timeline.py`，表名 `timeline_clips`；**无** `chapter_id` / `project_id` 字段，注释说明归属由应用层处理。
- `GET /api/v1/studio/projects/{project_id}/timeline` 在 `app/api/v1/routes/studio/projects.py` 中实现，**固定返回空列表**（仅校验项目存在），与 spec 要求的「章节时间线」不对齐。
- 前端 `VideoEditor` 曾消费项目级时间线 API，路由为 `App.tsx` 中 `/projects/:projectId/editor`；项目工作台 `EditTab` 通过 `getProjectEditorPath` 跳转该路由（`front/src/pages/aiStudio/project/ProjectWorkbench/tabs/EditTab.tsx`）。

### [事实] 任务与 Worker 扩展点

- 异步任务通过 `TaskManager.create` + `enqueue_task_execution` 模式创建（见 `app/api/v1/routes/film/generated_video.py`、`app/tasks/execute_task.py`）。
- `task_executor_registry` 在 `app/services/worker/task_registry.py` 中按 `task_kind` 注册；`video_generation` 使用 `AbstractAsyncDelegatingExecutor` 包装 `run_video_generation_task`。
- 任务与业务实体的关联通过 `GenerationTaskLink`（`app/models/task_links.py`），字段含 `resource_type`、`relation_type`、`relation_entity_id`、`file_id`。

### [事实] 对象存储与成品入库

- `app/core/storage.py` 提供 `upload_file`（S3 兼容，异步线程池包装 boto3）。
- `app/utils/files.py` 的 `create_file_from_url_or_b64` 负责从 URL/ base64 上传并创建 `FileItem` 记录；视频生成落库复用此路径。

### [事实] 部署镜像中无 FFmpeg

- `deploy/docker/backend.Dockerfile` 仅安装 `ca-certificates`、`curl` 与 Python 依赖，**未**安装 `ffmpeg`；Celery worker 复用同一镜像（`docker-compose.yml` 中 `celery-worker` 与 `backend` 同 Dockerfile）。要在 Worker 内做拼接，**需**在镜像中增加 `ffmpeg`（或侧车/外部媒体服务，属替代方案）。

### [事实] 章节与镜头列表

- 章节 API 在 `app/api/v1/routes/studio/chapters.py`；镜头列表在 `app/api/v1/routes/studio/shots.py`（需按 `chapter_id` 拉取并 `order by index`）——与「按镜头顺序铺时间线」一致。

---

## 2. 推断与方案约束

### [推断] 持久化形态

- 在现有 `timeline_clips` 上硬加 `chapter_id` 可复用表名，但当前模型字段为 `type/source_id/label/start/end/track`，与「按 `shot_id` 排序、可选 trim」的语义需大量 reinterpret；**更清晰**是新增 **章节时间线专用表**（如 `chapter_timeline_segments`：`(chapter_id, shot_id, position, trim_start_ms, trim_end_ms)`），P1 可只使用 `position`+`shot_id`。
- 与 spec 中「章节导出成品与章节可追溯关联」一致：`FileUsage` 新增 `usage_kind`（如 `chapter_master_video`）+ `project_id`/`chapter_id` 已存在于 `FileUsage` 模型（见 `app/schemas/studio/files.py` 中 `FileUsageWrite`）。

### [推断] 拼接实现

- Worker 内：按顺序从存储下载各 `FileItem` 到临时文件 → `ffmpeg` concat（若编码不一则需统一转码）→ `upload_file` + `FileItem` + `FileUsage` → 任务 `result` 含 `file_id`。
- 对内下载可使用 boto3 `get_object`（与 `storage` 模块同配置），无需依赖公网 URL。

### [事实]（已由 plan 收敛）

- **编码策略**：由用户在导出时选择——**默认「统一转码」**；可选 **「仅无损拼接」**（不一致则失败）。见 `plan.md` Decision 3。

---

## 3. 前端依赖

### [事实]

- Studio API 已统一通过 OpenAPI 生成客户端（`StudioProjectsService` 等），`initOpenAPI` 在 `front/src/services/openapi.ts`。
- MSW handlers 中仍为旧路径时需同步改为章节时间线路径（若继续启用 mock）。

---

## 4. 文档与产品边界

### [事实]

- `site` 中 roadmap/features 将时间线导出列为补强方向；与本 spec 一致。
- 任务中心边界：`film/task_status` 与 GenerationTaskLink 列表为通用任务信息入口。
