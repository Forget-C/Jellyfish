---
title: "任务异步化与取消方案"
description: "面向开发者说明 script-processing 等长耗时智能体接口的任务化、页面恢复与取消能力设计。"
weight: 8
---

## 背景

当前系统里已经有一套可用的任务基础设施：

- `TaskManager`
- `GenerationTask`
- `GenerationTaskLink`
- `/api/v1/film/tasks/{task_id}/status`
- `/api/v1/film/tasks/{task_id}/result`

但 `script-processing` 路由下仍有一批接口是**同步直接调用 Agent**。其中最典型的是：

- `/api/v1/script-processing/divide`

这类接口一旦耗时变长，会带来几个明显问题：

- 请求长时间阻塞
- 页面刷新后丢失上下文
- 用户无法明确知道当前是否已有任务在运行
- 当前任务体系有 `cancelled` 状态，但缺少真正的取消入口和取消执行机制

这份文档的目标，是给出一套可以渐进落地的方案：

```text
长耗时智能体接口任务化
→ 页面刷新后可恢复
→ 任务状态可见
→ 先支持请求取消与协作式停止
→ 强终止能力后置
```

## 核心结论

### 1. `divide` 应优先改为异步任务接口

建议新增：

```text
POST /api/v1/script-processing/divide-async
```

并保留原同步接口：

```text
POST /api/v1/script-processing/divide
```

这样可以兼顾：

- 前端主流程迁移
- 管理端或脚本调试
- 单测与回归验证

### 2. 页面恢复应复用现有任务体系

不建议为 `divide` 单独造一套新的任务模型。  
推荐直接复用：

- `GenerationTask`
- `GenerationTaskLink`

并通过下面这组业务关联恢复页面状态：

```text
relation_type = "chapter_division"
relation_entity_id = chapter_id
```

### 3. 取消能力要分阶段做

当前技术栈下，很多长任务本质上还是：

- 单次同步 Agent 调用
- 不一定暴露可中断句柄

因此第一阶段不要承诺“立即强终止”，而应先做：

- 请求取消
- 页面显示“已请求取消”
- worker 在检查点协作式停止

如果未来要强终止，再升级到：

- 运行句柄注册表
- 独立 worker 进程 / 队列系统

### 4. 当前最小执行层方案：MySQL + Redis + Celery

当前阶段不需要先迁移业务库。推荐最小方案为：

```text
业务库：MySQL
Broker：Redis
执行器：Celery Worker
任务真相：继续使用 GenerationTask / GenerationTaskLink
```

说明：

- `GenerationTask`
  - 继续作为任务状态、结果与取消请求的唯一真相源
- `Redis`
  - 仅作为 Celery broker
- `Celery Worker`
  - 真正执行 `divide / extract` 等长耗时任务

后端配置上：

- 若未单独指定 `CELERY_BROKER_URL`
- 会自动按 Redis 配置拼接：

```text
redis://[:password@]REDIS_HOST:REDIS_PORT/REDIS_DB
```

这让本地、compose、后续部署环境都能统一走同一套配置语义。

## Compose 联调与首轮验证

这套最小方案的验收重点不是“任务能不能跑”，而是：

> `divide / extract` 跑起来后，backend 是否还保持轻量可响应。

### 启动顺序

建议按下面这条链确认服务状态：

```text
mysql
→ redis
→ backend-migrate
→ backend-seed-system-data
→ backend
→ celery-worker
→ front
```

### 基础检查

先确认新增的两个服务已经可用：

- `redis`
  - `docker compose ... ps` 中应为 `healthy`
- `celery-worker`
  - 日志中应出现 `ready`
  - 并注册任务：
    - `task.execute`

### 第一轮功能验证

#### 场景 1：分镜管理页提取分镜

验证链路：

```text
点击“一键提取分镜”
→ divide-async 立即返回 task_id
→ celery-worker 开始执行
→ backend 仍能继续响应章节、分镜、task status 等接口
```

成功标准：

- 页面刷新后仍能恢复任务状态
- `/api/v1/film/tasks/{task_id}/status` 能正常返回
- 章节详情、分镜列表等接口不再被长任务拖住
- `backend` 日志只承担建任务、查状态、查结果
- 真正耗时的执行日志主要出现在 `celery-worker`

#### 场景 2：分镜编辑页提取资产

验证链路：

```text
点击“提取并刷新候选”
→ extract-async 立即返回 task_id
→ celery-worker 执行 extract
→ 页面刷新后继续恢复 task
→ backend 其他接口仍然可响应
```

成功标准与 `divide` 相同。

### 取消链路验证

在基础联调通过后，再验证：

1. 发起 `divide-async` 或 `extract-async`
2. 立即点击取消
3. 刷新页面
4. 确认状态经过：
   - `cancel_requested = true`
   - 后续在检查点进入 `cancelled`

### 若联调后仍然阻塞，优先检查

1. `celery-worker` 是否真正启动成功
2. 是否仍有漏网的 `asyncio.create_task(...)`
3. 页面是否误用了老的同步接口，而不是 `*-async`

## 为什么 `divide` 要优先任务化

### 当前问题

`/api/v1/script-processing/divide` 当前是同步 Agent 调用：

```text
请求进入
→ ScriptDividerAgent.divide_script(...)
→ 结果返回
```

这条链一旦慢下来，用户会直接感受到：

- 页面一直 loading
- 刷新页面后不知道任务是否还在跑
- 同一章节可能被重复触发提取

### 任务化后的目标

应改成：

```text
POST divide-async
→ 创建任务
→ 创建 task_link
→ 立即返回 task_id
→ 后台执行 divide
→ 页面按 chapter_id 恢复任务状态
```

## `divide-async` 设计

### 路由

```text
POST /api/v1/script-processing/divide-async
```

### 请求体

建议复用当前同步接口的请求体：

```json
{
  "chapter_id": "2a67890b-46a9-41ed-b220-18d18a3d300a",
  "script_text": "...",
  "write_to_db": true
}
```

### 返回体

```json
{
  "success": true,
  "code": 200,
  "message": "Task created",
  "data": {
    "task_id": "uuid",
    "status": "pending",
    "reused": false,
    "relation_type": "chapter_division",
    "relation_entity_id": "2a67890b-46a9-41ed-b220-18d18a3d300a"
  }
}
```

### 同章节活跃任务复用

建议增加业务约束：

> 同一 `chapter_id` 同时只允许一个活跃的 `chapter_division` 任务。

活跃状态包括：

- `pending`
- `running`
- `streaming`

如果存在活跃任务，则：

- 不重复创建
- 直接返回已有 `task_id`
- `reused = true`

这样可以解决：

- 重复点击
- 页面刷新后再次点击
- 多标签页并发触发

## 页面刷新后的关联与恢复

### 业务关联写法

`divide` 任务创建时写入：

```text
resource_type = "task"
relation_type = "chapter_division"
relation_entity_id = chapter_id
```

### 页面恢复方式

当用户进入这些页面时：

- 章节页
- 分镜列表页
- 项目工作台

可按 `chapter_id` 查询最新活跃任务：

```text
chapter_id
→ relation_type=chapter_division
→ latest active task
```

如果存在：

- 显示“正在提取分镜”
- 轮询任务状态
- 任务完成后刷新分镜列表

### 页面提示建议

统一展示：

- `正在提取分镜`
- `已请求取消`
- `提取失败`
- `提取完成`

## 取消能力设计

## 第一阶段：请求取消

新增接口：

```text
POST /api/v1/film/tasks/{task_id}/cancel
```

建议在 `generation_tasks` 表上新增字段：

- `cancel_requested`
- `cancel_requested_at`
- `cancel_reason`
- `cancelled_at`

这阶段先解决的是：

- 用户可以发起取消
- 页面知道取消请求已存在
- 任务状态接口能显示取消请求状态

这不等于任务一定能立刻停下。

## 第二阶段：协作式取消

在 worker 中增加取消检查点：

1. 任务启动前
2. 调用下一个 Agent 前
3. 多阶段流程的阶段边界
4. 写库前

如果检测到：

```text
cancel_requested = true
```

则：

- 停止后续步骤
- 将任务写成 `cancelled`
- 记录 `cancelled_at`

### 这种方式的限制

如果当前代码正卡在：

- 单次长时间同步模型调用
- 阻塞式 SDK 调用

那么第一阶段无法做到“立刻中断”，只能等待当前步骤结束后再停。

所以产品与开发文档里都应该明确：

> 第一阶段的取消能力属于“请求取消 + 协作式取消”，不是强终止。

## 第三阶段：运行句柄注册表

如果后续要增强取消能力，建议在 `TaskManager` 上新增运行句柄注册表：

```text
task_id -> asyncio.Task
```

这样对真正的异步后台任务，可以尝试：

- `task.cancel()`

但要注意：

> 即使有运行句柄，也不代表所有同步 LLM 调用都能立即停住。

## 第四阶段：强终止能力预留

如果未来业务明确要求“立即终止长任务”，就需要进一步升级架构，例如：

- 独立 worker 进程
- 队列系统
- 执行进程与 Web 进程隔离

到那时，才能更可靠地支持：

- kill worker
- 回收阻塞任务
- 更强的取消语义

当前阶段，不建议直接跳到这一步。

## 当前落地状态

### 主线接口：已完成任务化并接入真实页面

- `/api/v1/script-processing/divide`
- `/api/v1/script-processing/extract`
- `/api/v1/script-processing/check-consistency`
- `/api/v1/script-processing/optimize-script`
- `/api/v1/script-processing/simplify-script`
- `/api/v1/script-processing/analyze-character-portrait`
- `/api/v1/script-processing/analyze-prop-info`
- `/api/v1/script-processing/analyze-scene-info`
- `/api/v1/script-processing/analyze-costume-info`

这些接口当前都已经进入：

```text
异步任务
→ 页面按业务实体恢复任务
→ 可请求取消
→ 协作式取消
```

### 预备能力：已任务化但当前无真实前端入口

- `/api/v1/script-processing/merge-entities`
- `/api/v1/script-processing/analyze-variants`

这两条接口当前不再列为前端主线整改项，处理策略是：

- 保留后端实现、测试与 OpenAPI
- 在路由描述与代码注释中标明“预备能力”
- 等未来出现真实页面入口后，再按同一套任务恢复模型接入

## 推荐的 relation_type 约定

建议统一使用这批值：

```text
chapter_division
script_extraction
entity_merge
consistency_check
variant_analysis
character_portrait_analysis
prop_info_analysis
scene_info_analysis
costume_info_analysis
script_optimization
script_simplification
```

当前已落地：

- `chapter_division`
- `script_extraction`
- `consistency_check`
- `script_optimization`
- `script_simplification`
- `character_portrait_analysis`
- `prop_info_analysis`
- `scene_info_analysis`
- `costume_info_analysis`
- `entity_merge`
- `variant_analysis`

## 实施顺序回顾与后续建议

### 已完成阶段

1. `generation_tasks` 增加取消字段
2. `TaskStore / TaskManager` 增加取消请求能力
3. 新增 `script_processing_tasks.py`
4. `divide-async / extract-async` 落地
5. 页面按业务实体恢复 `divide / extract` 任务
6. `check-consistency / optimize-script / simplify-script` 接入任务体系
7. 资产分析类接口接入任务体系
8. worker 协作式取消检查点补齐第一轮

### 当前收口重点

1. 清理未启用接口的前端接入预期
2. 在路由描述、代码注释、开发文档中明确：
   - 哪些是主线接口
   - 哪些是预备能力
   - 哪些同步接口只用于兼容与调试

### 后续建议

1. 继续观察是否会新增真实页面入口
2. 如果未来重新启用 `merge-entities / analyze-variants`，再按同一套任务恢复模型接入
3. 如果业务明确要求更强的终止能力，再推进运行句柄注册表或独立 worker

## 对前端的约束

页面不应只依赖本地缓存 taskId。  
正确做法是：

```text
页面打开
→ 根据业务实体查最新活跃任务
→ 恢复轮询
→ 根据任务状态更新 UI
```

也就是说：

- 章节页看 `chapter_division`
- 分镜编辑页看 `script_extraction`
- 不以“页面是否没刷新”为前提

## 对产品语义的建议

当前阶段建议统一对外说明：

### 用户可看到

- 任务进行中
- 已请求取消
- 已完成
- 已失败

### 用户暂时不要期待

- 点击取消后立即硬停止

更准确的提示文案应是：

> 已请求取消，系统会在当前步骤结束后停止。

## 最终建议

这轮最值得先做的，不是一步到位上强终止，而是：

```text
divide 异步任务化
→ 页面刷新可恢复
→ 任务状态可见
→ 取消请求可登记
→ worker 协作式停止
```

这样能先解决绝大多数体验问题，同时为后续更强的任务控制能力留好扩展点。
