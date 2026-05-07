# Tasks: 章节视频剪辑与时间线导出

**Workspace**: `video-timeline-editor` | **Date**: 2026-05-06  
**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Explore**: [explore.md](explore.md)

---

## 统计

| 项 | 数量 |
|----|------|
| 实现任务总数 | 18 |
| 含 [US1] | 4 |
| 含 [US2] | 2 |
| 含 [US3] | 5 |
| 可并行 [P] | 0（建议按 Phase 顺序执行） |
| [US4] P2（裁剪） | 1（本期可跳过） |

**建议 MVP 范围**: Phase 1～4（覆盖 Spec US1–US3；不含 US4 trim）。

**Small Replan**: 无（验证阶段 Plan 与代码路径一致：`chapters` 路由、`AbstractAsyncDelegatingExecutor`、`enqueue_task_execution`、`TaskCreated`、`backend/sql` 编号接续）。

**建议下一步**: 可选运行 SDD `analyze` 做产物一致性检查 → 执行 `implement` 按 Phase 落地。

---

## Phase 1 — 数据库与 ORM 基座

### 实现

- [ ] T001 新增章节时间线 DDL 与现有 `backend/sql/` 编号对齐（建议 `009-chapter-timeline.sql`）：`chapter_timeline_states`（可选若 MVP 只做 `layout_version` 可合并进单表策略——以 [data-model.md](data-model.md) 为准）、`chapter_timeline_segments`、必备索引与外键（`ON DELETE CASCADE`）。
  - files: [新增] `backend/sql/009-chapter-timeline.sql`（编号以仓库当前最大序号+1 为准）
  - symbols: N/A
  - tests: N/A（纯 SQL 文件；门禁由集成迁移验证）
  - integrates: compose `mysql-init-sql` 或本地手工 `mysql < sql` 执行路径与仓库惯例一致

- [ ] T002 新增 ORM：`ChapterTimelineState`、`ChapterTimelineSegment`（字段与 [data-model.md](data-model.md) 一致）；在 `app/models/studio.py` 聚合 `__all__` 导出；确保 `app/core/db.py` 的 `init_db()` 导入链能注册 metadata（通常通过 `import app.models.studio` 已足够，若模型在新文件需在 `studio.py` re-export）。
  - files: [新增] `backend/app/models/studio_timeline_chapter.py`; [修改] `backend/app/models/studio.py`
  - symbols: `ChapterTimelineSegment`, `ChapterTimelineState`
  - tests: [新增] `backend/tests/models/test_chapter_timeline_import.py`（最小：import ORM + `Table` 存在性，可选）
  - integrates: `Base.metadata` 与 `Shot`/`Chapter` FK

- [ ] T003 扩展 `FileUsageKind`：新增 `chapter_master_video`（或 plan 命名）；同步所有依赖该枚举的校验/Schema 注释（如 `FileUsageWrite.usage_kind` 描述字符串）。
  - files: [修改] `backend/app/models/types.py`; [修改] `backend/app/schemas/studio/files.py`（description 列举）
  - symbols: `FileUsageKind`
  - tests: [修改] 若有枚举穷尽测试则更新；否则 N/A
  - integrates: 后续 `FileUsage` 写入导出成片

### 门禁

- [ ] G1-1 后端可导入：`cd backend && uv run python -c "from app.main import app"`
- [ ] G1-2 静态：`cd backend && uv run pylint`（范围：本 Phase  touched 文件，按仓库惯例）
- [ ] G1-3 测试：`cd backend && uv run pytest tests/models/test_chapter_timeline_import.py -q`（若 T002 未写该文件则改为 `pytest tests/test_studio_api_responses.py -q` 冒烟）

---

## Phase 2 — [US1][US2] 时间线组装与读写 API

### 实现

- [ ] T004 [US1][US2] 实现 `app/services/studio/chapter_timeline.py`（命名可与 plan 一致）：`build_timeline_read(db, chapter_id)`（合并 DB 片段顺序 + 默认 shot.index 顺序、`clip_status`: ready / missing_video / file_missing）、`replace_timeline_segments(db, chapter_id, segments, layout_version?)`（事务替换、`shot_id` 归属校验、唯一约束）；可选 `get_or_bump_timeline_state`。
  - files: [新增] `backend/app/services/studio/chapter_timeline.py`; [修改] `backend/app/services/studio/__init__.py`（如需导出）
  - symbols: `build_timeline_read`, `replace_timeline_segments`
  - tests: [新增] `backend/tests/services/test_chapter_timeline_service.py`（Fake DB 或 sqlite/async 现有惯例）
  - integrates: `Shot`, `FileItem`, `ChapterTimelineSegment`

- [ ] T005 [US1][US2] Pydantic：`ChapterTimelineRead` / `ChapterTimelineSegmentRead` / `ChapterTimelineWrite` / `ChapterTimelineSegmentWrite` / `TimelineClipStatus`（字符串枚举）；与 [contracts/chapter-timeline-api.yaml](contracts/chapter-timeline-api.yaml) 对齐。
  - files: [新增] `backend/app/schemas/studio/chapter_timeline.py`
  - symbols: `ChapterTimelineRead`, `ChapterTimelineWrite`
  - tests: N/A（由 API 测试覆盖）
  - integrates: FastAPI `response_model`

- [ ] T006 [US1][US2] 在 `app/api/v1/routes/studio/chapters.py` 注册 **`/{chapter_id}/timeline` 先于** `/{chapter_id}` 的单段路由冲突检查（FastAPI 同前缀下保证 `/timeline` 子路径可用）：`GET` 返回 `ApiResponse[ChapterTimelineRead]`；`PUT` 持久化；`layout_version` **MVP 可选**：若实现乐观锁，冲突返回 409 与 plan Decision 4 一致。
  - files: [修改] `backend/app/api/v1/routes/studio/chapters.py`
  - symbols: `get_chapter_timeline`, `put_chapter_timeline`
  - tests: [新增] `backend/tests/test_chapter_timeline_api_responses.py`（复用 `test_studio_api_responses.py` 的 `_FakeStudioDB` 模式或 `TestClient` + 依赖覆盖）
  - integrates: `get_or_404(Chapter)`, `success_response`, `HTTPException`

### 门禁

- [ ] G2-1 `cd backend && uv run pytest tests/test_chapter_timeline_api_responses.py tests/services/test_chapter_timeline_service.py -q`
- [ ] G2-2 `cd backend && uv run pylint`（touched files）

---

## Phase 3 — [US3] 导出任务、Worker、FFmpeg

### 实现

- [ ] T007 [US3] 实现「活跃导出检测」：查询 `GenerationTask` + `GenerationTaskLink`，条件：`task_kind=chapter_timeline_export`、`relation_entity_id=chapter_id`、`resource_type=video`（或与视频任务一致）、`status in (pending, running)`（以 `GenerationTaskStatus` 实际枚举为准）；存在则 `HTTP 409` + `AsyncTaskCreateRead` 或统一错误壳携带已有 `task_id`。
  - files: [新增] `backend/app/services/studio/chapter_timeline_export.py`（或并入 `chapter_timeline.py`）
  - symbols: `find_active_chapter_timeline_export`, `create_chapter_timeline_export_task`
  - tests: [修改] `backend/tests/test_chapter_timeline_api_responses.py`
  - integrates: `SqlAlchemyTaskStore`, `TaskManager`, `GenerationTaskLink`

- [ ] T008 [US3] `POST /chapters/{chapter_id}/timeline/export`：请求体 `encode_mode`（默认 `uniform_transcode`）、可选 `idempotency_key`；校验时间线全部 `ready`；创建任务、`GenerationTaskLink(relation_type=chapter_timeline 等)`、`enqueue_task_execution`；响应 `201` + `TaskCreated`（与 `film/generated_video` 一致）。
  - files: [修改] `backend/app/api/v1/routes/studio/chapters.py`; [修改] `backend/app/schemas/studio/chapter_timeline.py`
  - symbols: `post_chapter_timeline_export`
  - tests: [修改] `backend/tests/test_chapter_timeline_api_responses.py`（400 缺片、409 重复进行中）
  - integrates: `TaskManager.create`, `enqueue_task_execution`（`app/tasks/execute_task.py`）

- [ ] T009 [US3] 异步 Runner：`async def run_chapter_timeline_export_task(task_id: str, run_args: dict) -> None`：按章节顺序解析 `file_id`（仅接受属于该 chapter 的 `Shot.generated_video_file_id` 链，**禁止**信任客户端任意 file_id）；下载临时文件（`storage` / boto3 与现有 `create_file_from_url_or_b64` 路径对齐）；`ffprobe` 探测；`encode_mode` 分支——`uniform_transcode` 统一编码、`lossless_concat_only` 不一致则失败；`ffmpeg` 拼接；`upload_file` + `FileItem` + `FileUsage(chapter_master_video)` + 更新 `GenerationTaskLink.file_id` + `set_result`/`set_status`。
  - files: [新增] `backend/app/services/studio/chapter_timeline_export_task.py`（或 `app/services/film/` 下若更希望归类「成片」——以不与分层冲突为准）
  - symbols: `run_chapter_timeline_export_task`
  - tests: [新增] `backend/tests/services/test_chapter_timeline_export_task.py`（`unittest.mock` mock `subprocess`/`asyncio.create_subprocess_*` 与 storage）
  - integrates: `AbstractAsyncDelegatingExecutor`, `async_session_maker`, `SyncSqlAlchemyTaskStore`（若 runner 内用 async store 则与 `generated_video` 对齐）

- [ ] T010 [US3] 注册 `task_executor_registry.register("chapter_timeline_export", AbstractAsyncDelegatingExecutor(..., timeout_seconds=7200))`。
  - files: [修改] `backend/app/services/worker/task_registry.py`
  - symbols: `task_executor_registry.register`
  - tests: [修改] `backend/tests/test_task_registry.py`（断言 kind 可 resolve）
  - integrates: `execute_task.run_task_celery`

- [ ] T011 [US3] Docker：`deploy/docker/backend.Dockerfile` 安装 `ffmpeg`（及 `ffprobe` 通常随包）；文档注释说明 Worker 与 API 共用镜像。
  - files: [修改] `deploy/docker/backend.Dockerfile`
  - symbols: N/A
  - tests: N/A
  - integrates: Celery worker 容器

### 门禁

- [ ] G3-1 `cd backend && uv run pytest tests/test_chapter_timeline_api_responses.py tests/services/test_chapter_timeline_export_task.py tests/test_task_registry.py -q`
- [ ] G3-2 `cd backend && uv run pylint`（touched files）

---

## Phase 4 — 前端路由、剪辑页、OpenAPI

### 实现

- [ ] T012 [US1][US2][US3] OpenAPI：`pnpm run openapi:update`（或后端导出 `openapi.json` + `pnpm run openapi:gen`）；契约路径 `/api/v1/studio/chapters/{chapter_id}/timeline` 与 export；生成 `StudioChaptersService` 或等价客户端方法。
  - files: [修改] `front/openapi.json`; [修改] `front/src/services/generated/**`
  - symbols: OpenAPI `operationId` 与前端调用名
  - tests: N/A
  - integrates: `initOpenAPI`（`front/src/services/openapi.ts`）

- [ ] T013 [US1][US2] 路由：`getChapterTimelinePath(projectId, chapterId)`；`App.tsx` 注册 `/projects/:projectId/chapters/:chapterId/timeline`（或 `/editor` 重定向）；**剪辑页**使用生成客户端拉取 `GET timeline`、`PUT` 保存；列表展示 `clip_status`；文案说明「本期以编排与导出为主、连续全片预览见后续」。
  - files: [修改] `front/src/pages/aiStudio/project/ProjectWorkbench/routes.ts`; [修改] `front/src/App.tsx`; [修改] `front/src/pages/aiStudio/editor/VideoEditor.tsx`（或重命名为 `ChapterTimelineEditor.tsx`）
  - symbols: React 组件默认导出
  - tests: N/A（门禁手动）
  - integrates: `StudioProjectsService` / 新生成的 Chapters 服务

- [ ] T014 [US3] 导出 UI：`encode_mode` 默认「统一转码」勾选；调用 `POST .../export`；展示返回 `task_id`；引导至任务中心（现有路由）；处理 400/409。
  - files: [修改] `front/src/pages/aiStudio/editor/VideoEditor.tsx`（或同上）
  - symbols: N/A
  - tests: N/A
  - integrates: 任务中心路由

- [ ] T015 [US1] 工作台入口：`EditTab` 由「仅 projectId editor」改为导航到章节列表或在章节行增加「剪辑」（最小改动：先 `navigate(getProjectChaptersPath)` 并在 UI 文案说明「请进入章节后再打开剪辑」——若已实现章节行按钮则直达 timeline）。
  - files: [修改] `front/src/pages/aiStudio/project/ProjectWorkbench/tabs/EditTab.tsx`; 可选 [修改] 章节列表页组件
  - symbols: `getChapterTimelinePath`, `getProjectChaptersPath`
  - tests: N/A
  - integrates: React Router

- [ ] T016 MSW：若 `VITE_USE_MOCK=true` 仍使用，更新 handler 匹配 `GET/PUT/POST .../chapters/:id/timeline...` 与统一响应壳。
  - files: [修改] `front/src/mocks/handlers.ts`
  - symbols: N/A
  - tests: N/A
  - integrates: 本地无后端开发

### 门禁

- [ ] G4-1 `cd front && pnpm exec tsc --noEmit`
- [ ] G4-2 手动验收（全栈）：启动 backend + worker + front → 某章节至少一镜有成片 → 打开章节剪辑页 → 看见片段与状态 → 调整顺序保存刷新验证 → 勾选默认统一转码导出 → 任务成功 → 文件库出现新视频（Given/When/Then 对齐 Spec US1–US3）

---

## Phase 5 — 架构文档与 [US4] 占位

### 实现

- [ ] T017 更新 `site/content/docs/architecture/`：记录章节时间线、导出任务、`encode_mode`、任务中心边界（与 jellyfish-doc-governance 一致）。
  - files: [新增或修改] `site/content/docs/architecture/` 下合适短文（如 `chapter-timeline-export.md`）并更新 `_index.md` 导航若需要
  - symbols: N/A
  - tests: N/A
  - integrates: 文档治理

- [ ] T018 [US4] （P2 / 可延期）为 `trim_start_ms`/`trim_end_ms` 打通：`PUT` 体写入 DB；导出 runner `ffmpeg -ss/-to` 或 filter；前端片段编辑控件。
  - files: [修改] 前后端相应模块
  - symbols: segment trim 字段
  - tests: [新增] 服务与 API 用例
  - integrates: Spec User Story 4

### 门禁

- [ ] G5-1 若 T018 未做：在 tasks.md 或 spec 中标注 US4 延期即可通过本 Phase
- [ ] G5-2 文档站点构建（若仓库有 `pnpm` workspace 命令则执行；否则跳过并在 Notes 说明）

---

## Notes

- **Runner 与 Executor**：若 `AbstractAsyncDelegatingExecutor` 的路径与 `run_video_generation_task` 不一致（例如 status 写回），必须以 **`generated_video.run_video_generation_task` 为样板** 对齐 async session 与 `SqlAlchemyTaskStore`。
- **安全**：`run_args` 内若含 `chapter_id`，runner 内再次校验所有 `shot_id`、`file_id` 属于该章节。
- **FFmpeg 不可用环境**：单测必须 mock 子进程；CI 可不装 ffmpeg，集成测试跳过或标记 `@pytest.mark.integration`。
