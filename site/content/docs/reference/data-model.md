---
title: "数据模型"
---

## 当前主链路

`Project → Chapter → Sequence → 场次版本 → 生产单元 → Task → Take → 时间线片段／章节交付`

| 对象 | 职责与边界 |
| --- | --- |
| Project / Chapter | 项目风格、资产、章节原文与场次顺序 |
| Sequence | 故事场次，区别于场所资产 Scene |
| SceneVersionRecord | 明确创建的可编辑场次方案；revision 用于并发保存，不是保存历史 |
| 生产单元 | 场次版本内明确身份、动作覆盖、模型及参考的执行范围 |
| Task / TaskInput / TaskOutput | 通用执行状态、固定输入及输出关联 |
| SceneTakeRecord | 新场次版本生成的真实候选，保留原任务与生产依据 |
| 时间线片段 | 独立采用身份、源素材区间、位置与构图；不等同于 Take |
| SceneDeliveryRecord / SceneDeliveryUse | 固定交付内容及章节明确使用指向 |
| FileItem / FileUsage | 文件身份与业务引用保护 |
| ExperimentSession / ExperimentMessage | 实验室会话及用户可见历史 |
| GenerationCanvas | 独立生成画布文档与运行范围，不能套用场次版本存储身份 |

旧 `directing_revisions` 及旧生产计划 Take 仍按原固定身份读取；旧 Shot、ShotDetail 和镜头槽位生成路径已经退役，不是当前主业务模型。

字段与关系以 `backend/app/models`、`backend/app/core/contracts` 为准。参见[场次架构](/docs/architecture/directing-foundation/)、[任务执行](https://github.com/Forget-C/Jellyfish/blob/main/docs/development/architecture/task-execution.md)和[生成画布](/docs/architecture/generation-canvas/)。
