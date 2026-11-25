# 数据模型

## 当前主链路

- 场次分镜沿 `Project → Chapter → Sequence → GenerationCanvas` 定位画布。画布记录保存修订，运行记录追踪执行节点及结果。自由画布使用独立身份。
- 生产计划以 `DirectingRevision` 固定计划依据。拍摄任务产出 `Take`，剪辑修订通过 `CutTakeReference` 记录采用关系，`ActiveCut` 指向最近一次明确确认的剪辑修订。分镜画布运行结果仍由画布管理。

| 共享对象 | 职责与边界 |
| --- | --- |
| Task / TaskInput / TaskOutput | 通用执行状态、固定输入及输出关联 |
| FileItem / FileUsage | 文件身份与业务引用保护 |
| ExperimentSession / ExperimentMessage | 实验室会话及用户可见历史 |

旧四画布的场次版本、专属 Take 和章节交付表已退出新基线。存储范围与旧库边界见[退役决策](../adr/0014-retire-scene-version-api.md#从空库初始化的新基线)。

字段与关系以 `backend/app/models`、`backend/app/core/contracts` 为准。参见[场次架构](../architecture/directing-foundation.md)、[任务执行](../architecture/task-execution.md)和[生成画布](../architecture/generation-canvas.md)。
