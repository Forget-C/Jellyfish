---
title: "v0.1.0-beta 发布说明"
date: 2026-04-03
description: "Jellyfish 后端第一阶段发布说明，覆盖 route -> service 重构、响应壳统一、分镜状态闭环、assets-overview 聚合接口、OpenAPI 同步约定与测试补强。"
---

这一阶段的重点，不是继续堆功能，而是把已经跑通的主流程收成一套更稳定的工程结构。

如果用一句话概括，这一轮发布完成了：

- 路由瘦身与 Service 分层
- 接口响应壳与错误风格统一
- 分镜状态流转闭环
- 分镜资产视图聚合
- OpenAPI 同步约定落地
- 测试与迁移补强

## ✨ 本次发布摘要

这一轮最关键的变化有 5 条：

- `route -> service -> common` 的后端分层已经正式建立
- `shot.status` 现在有了真正可维护的后端状态机
- 新增 `shot_extracted_candidates`，把提取确认流程变成正式中间状态
- 新增 `assets-overview`，把分镜资产视图从前端拼接改成后端聚合
- 前端接口调用约定收紧为：**接口更新后主动执行 `pnpm run openapi:update`，并优先使用 generated client**

## 🚀 Added

### 1. Common 能力层

新增：

- `services/common/validators.py`
- `services/common/crud.py`
- `services/common/errors.py`

这一层统一了承担高频样板逻辑的公共能力：

- 存在性校验
- 基础 CRUD helper
- 常用错误文案模板

它的直接效果是：

- route 更薄
- service 不再重复写样板代码
- 错误风格更统一

### 2. Studio / LLM / Film Service 层

这一轮新建或重构了大量 service，重点包括：

- `services/studio/shots.py`
- `services/studio/shot_assets.py`
- `services/studio/shot_details.py`
- `services/studio/shot_dialogs.py`
- `services/studio/shot_frames.py`
- `services/studio/shot_character_links.py`
- `services/studio/script_division.py`
- `services/studio/files.py`
- `services/studio/image_task_validation.py`
- `services/studio/image_task_references.py`
- `services/studio/image_task_prompts.py`
- `services/studio/image_task_runner.py`
- `services/llm/manage.py`
- `services/film/generated_video.py`
- `services/film/shot_frame_prompt_tasks.py`

这意味着 Studio 主链路、LLM 配置链路、Film 任务链路，都已经不再继续堆在 route 文件里。

### 3. 分镜提取确认中间表

新增正式数据结构：

- `shot_extracted_candidates`

同时 `Shot` 新增：

- `skip_extraction`
- `last_extracted_at`

`shot_extracted_candidates` 的作用是记录：

- 某个镜头从剧本提取出的候选项
- 当前是否仍待处理
- 是否已关联
- 是否已忽略

候选项状态现在是正式状态，而不是前端临时拼出来的 UI 数据。

### 4. 分镜资产聚合接口

新增接口：

- `GET /api/v1/studio/shots/{shot_id}/assets-overview`

这个接口专门返回：

- 当前已关联资产
- 待确认候选资产
- 每项的 `candidate_status`
- 每项是否已关联
- 汇总统计 `summary`

它的目标很明确：

> 把“分镜资产视图”的真相收回后端，不再让前端自己拼 `linked-assets + extracted-candidates`。

### 5. 分镜状态流转开发文档与迁移 SQL

这一轮同步补了：

- 开发文档：
  - `site/content/docs/guide/shot-status-flow.md`
- 迁移 SQL：
  - `backend/sql/002-add-shot-extracted-candidates.sql`

这意味着这条状态链不只是代码可用，也已经有了可追溯的设计说明与数据库迁移入口。

## 🔄 Changed

### 1. Route 更薄，边界更清晰

`app/api/v1/routes/` 现在主要只做：

- 接收参数
- 依赖注入
- 调 service
- 包装 `ApiResponse`

复杂业务逻辑、跨实体校验、文件处理、任务编排，已经大幅下沉到 service 层。

### 2. 响应壳统一

这一轮统一了成功响应风格：

- `created_response(...)`
- `success_response(...)`
- `empty_response()`
- `paginated_response(...)`

这让创建、删除、列表接口的响应行为更稳定，前端也更容易统一处理。

### 3. 错误文案统一

新增并逐步接入：

- `entity_not_found(...)`
- `entity_already_exists(...)`
- `required_field(...)`
- `invalid_choice(...)`
- `not_belong_to(...)`
- `relation_mismatch(...)`

仍然保留少量带上下文信息的特例文案，用于排障。

### 4. `entities.py` 拆分

原本较重的 `entities.py` 已拆成：

- `entity_crud.py`
- `entity_images.py`
- `entity_existence.py`
- `entity_specs.py`
- `entity_thumbnails.py`
- `entities.py`（协调层）

现在它不再是一个大而杂的巨型实现文件，而更像明确职责的协调层。

### 5. 前端接口调用方式收紧

这轮明确新增了一条开发约定：

> **接口更新后，前端需要主动执行 `pnpm run openapi:update`。**

同时，前端这批新逻辑已经改成优先使用：

- OpenAPI generated client

而不是再手写一层重复 service。

## 🧠 分镜状态闭环

这一轮最关键的结构性变化，是把 `shot.status` 真的接成了一条可维护的后端状态链。

### `shot.status` 现在的正式语义

- `pending`
  - 当前镜头还没有完成进入视频生成前的确认流程
- `ready`
  - 当前镜头已经具备进入视频生成流程的前置条件

这里的 `ready` 已经明确收敛成：

> 当前分镜已经完成信息提取确认，因此可以进入视频生成流程。

需要特别注意：

> 运行中的生成任务已经不再写入 `shot.status`。
> “生成中”应通过 `GenerationTask / GenerationTaskLink`
> 动态聚合得到，而不是复用 `pending / ready` 这类静态状态。

### `ready` 的最小必要条件

当前后端按下面这套规则统一计算：

1. `skip_extraction = true`：
   - `ready`
2. 从未提取过：
   - `pending`
3. 提取过，但当前镜头没有任何候选项：
   - `ready`
4. 所有候选项都已处理完（`linked / ignored`）：
   - `ready`
5. 其他情况：
   - `pending`

这里“候选项已处理完”是正式规则，不再由前端猜测。

### 两条合法进入 `ready` 的路径

当前镜头可以通过两条路径进入 `ready`：

```text
路径 A：
提取
→ 候选全部处理完
→ ready

路径 B：
明确无需提取
→ skip_extraction = true
→ ready
```

### 候选项状态回写闭环

这次不是只增加了表结构，而是把真实业务动作接进来了。

当前已经完成这些自动回写：

- 提取完成后，同步写入 `shot_extracted_candidates`
- 角色关联成功后，角色 candidate 自动回写 `linked`
- 场景 / 道具 / 服装关联成功后，自动回写 `linked`
- `ShotDetail.scene_id` 设置成功后，场景 candidate 自动回写 `linked`
- 删除场景 / 道具 / 服装关联后，candidate 回退 `pending`
- 角色同 index 被替换时，被顶掉的旧角色 candidate 回退 `pending`
- `scene_id` 从 A 改到 B，或清空为 `None` 时，旧场景 candidate 回退 `pending`

所以现在的正式流转已经是：

```text
提取
→ candidate 入库
→ 关联后 linked
→ 忽略后 ignored
→ 取消关联 / 替换 / 清空后回退 pending
→ shot.status 自动重算
```

### “无对白”不再影响 `ready`

这一轮还明确收掉了一个语义歧义：

> 无对白的镜头，不应因为“没有对白”而被判定为状态未完成。

当前规则已经明确：

- 正式 `shot.status` 与对白数量无关
- 无对白镜头，只要提取确认闭环完成，仍然可以进入 `ready`

这条规则已经同时在：

- 后端 `shot_status` 计算
- `ChapterStudio`
- `ChapterShotEditPage`
- `ChapterShotsPage`

收口过一轮，并补了回归测试。

## 🖥️ 前端协作方式变化

这轮除了后端结构变化，前端与后端的协作方式也发生了很关键的调整。

### 1. 分镜编辑页默认展示“已关联资产 + 待确认候选”的并集

`ChapterShotEditPage` 现在默认展示的是：

- 已关联资产
- `shot_extracted_candidates` 中仍待处理的候选

而不是：

- 只有点了“提取资产”以后，才临时显示候选

### 2. 分镜编辑页已切到 `assets-overview`

分镜编辑页现在已经改成优先使用：

- `GET /api/v1/studio/shots/{shot_id}/assets-overview`

不再长期自己拼：

- `linked-assets`
- `extracted-candidates`
- `extraction-draft`

### 3. 分镜工作室职责收口

`ChapterStudio` 这轮也做了一个非常重要的职责调整：

- **不再调用** `/api/v1/script-processing/extract`
- 不再保留页面内提取缓存与批量预取
- `画面描述 / 资产就绪度` 只负责展示：
  - `assets-overview`
  - `shot.status`
  - `skip_extraction`
- 正式提取与确认动作统一收敛到：
  - `ChapterShotEditPage`

也就是说：

```text
ChapterStudio
→ 看状态
→ 跳转分镜编辑确认

ChapterShotEditPage
→ 提取
→ 关联 / 忽略 / 新建
→ 完成确认
```

这条职责线现在已经清晰很多了。

### 4. 分镜页面职责继续收口

这轮后续前端又继续把两页边界往前收了一步：

- `ChapterShotEditPage`
  - 明确强化为“分镜准备 / 信息确认”主入口
  - 负责提取、确认、修正，并把镜头推进到 `ready`
- `ChapterStudio`
  - 明确强化为“章节生成工作台”
  - 负责 `video-readiness`、关键帧、参考图、视频参数与视频生成

对应推荐主流程也更明确了：

```text
分镜编辑页
→ 提取与确认
→ shot.status = ready
→ 进入分镜工作室
→ 查看 video-readiness
→ 关键帧 / 参考图 / 视频参数
→ 生成视频
```

## 🐞 Fixed

### 1. `ignore extracted candidate` 的 500

修复了：

- `PATCH /api/v1/studio/shots/extracted-candidates/{id}/ignore`

返回时因为 `updated_at` 懒加载触发 `MissingGreenlet` 的问题。

修复方式是统一补：

- `flush + refresh`

确保 ORM 对象在异步序列化前状态完整。

### 2. `assets-overview` 的 Enum / str 兼容问题

修复了新接口在某些 ORM 返回路径下：

- `candidate_type`
- `candidate_status`

可能是 `str` 而不是 Enum，导致：

- `'str' object has no attribute 'value'`

现在已经统一兼容：

- Enum
- str

### 3. 重新提取后已关联项被错误重置

修复了这条关键问题：

> 已 `linked` 的 candidate，在重新提取后被错误重置成 `pending`

现在重新提取时：

- 同名同类、且此前已 `linked` 的候选
- 会继续保持 `linked`

这也直接修掉了页面上那种：

- 关联 1 个
- 忽略 4 个
- 刷新后再提取
- 再忽略 4 个
- 却仍显示“还有 1 项待处理”

的错误统计问题。

### 4. 前端旧请求覆盖新状态

补了“latest request wins”保护，避免：

- 旧 overview 请求晚返回
- 把新状态覆盖掉

这层保护现在已经加在：

- `ChapterShotEditPage`
- `ChapterStudio`

## 🧪 Testing

这轮整理里，测试不是最后补的，而是跟着结构变化同步往前推的。

### Service 层

已经覆盖到：

- common helpers
- llm 管理
- 镜头角色关联
- 剧本分镜写库
- 文件服务
- 视频生成
- 分镜帧提示词任务
- `image_task_*`
- `shot_status` / `shot_extracted_candidates`

### API 层

已经覆盖到：

- `prompts`
- `llm/providers`
- `projects / chapters / shots`
- `shot-details / shot-dialog-lines / shot-frame-images`
- `files`
- `task_status`
- `shot_character_links`
- `image_tasks`
- `generated_video`
- `tasks_images`
- `entities`

### 当前结果

这一轮阶段结束时，从仓库根目录执行：

```bash
uv run pytest backend/tests -q
```

结果为：

```text
125 passed
```

而且根目录与 `backend/` 两种入口都已经稳定，不再出现 async 用例误跳过的问题。

## 🗃️ Migration Notes

这一轮涉及数据库结构变化，必须先执行迁移 SQL：

- `backend/sql/002-add-shot-extracted-candidates.sql`

特别需要注意：

- 代码已经依赖：
  - `shots.skip_extraction`
  - `shots.last_extracted_at`
  - `shot_extracted_candidates`
- 如果数据库没有先迁移，运行时会报：
  - `Unknown column 'shots.skip_extraction'`

所以这轮上线顺序应该是：

1. 执行数据库迁移
2. 部署后端代码
3. 更新前端 generated client

## 👩‍💻 Developer Notes

这一轮新增了一条明确约定：

> **后端接口有更新时，前端需要主动执行 `pnpm run openapi:update`。**

同时也建议遵守这两条：

- 前端优先使用 generated client
- 不再额外手写一层重复 service 去包 OpenAPI 已有接口

这一约定已经在本轮新接口接入中实际执行：

- `assets-overview`
- `skip_extraction`
- extracted-candidates 相关接口

都已经按这个约定同步过一轮。

## ⚠️ Known Gaps

这一轮不是终局，仍然保留了一些刻意未完全收口的点：

- `dependencies.py` 里仍有部分手写 `HTTPException`
- 少量错误文案仍保留上下文特例
- 个别 route / service 命名还可继续统一
- `entities.py` 虽然已拆分，但仍属于相对复杂的通用实体服务

这些已经不是结构阻塞项，更像下一轮工程化清理对象。

## ✅ 发布结论

如果把这一轮压缩成一句话，它真正完成的是：

- 后端分层更清楚了
- 接口行为更统一了
- 分镜状态流转正式闭环了
- 前端不再长期猜资产状态了
- 测试和迁移护栏也补起来了

这意味着后续不管继续做：

- 交互优化
- 提示词优化
- 剪辑能力补强
- 数据模型标准化

都已经有了一个更稳的后端基础。
