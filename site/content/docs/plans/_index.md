---
title: "任务计划"
weight: 4
description: "记录当前正在推进的开发计划、改造方案与阶段性执行清单。"
---

这里记录 Jellyfish 当前仍在推进中的任务计划与重构方案。

- 放这里的内容允许持续更新，因为它描述的是**接下来做什么**。
- 当某项计划已经稳定落地后，应优先沉淀到 [当前架构](/docs/architecture/) 或发布到 `blog` 中。

当前计划入口：

- [章节入口与整章划分工作流优化计划](/docs/plans/chapter-division-workflow-plan/)：待实施；动态章节操作、章节组合单一入口、统一关闭、AI 默认视图及手动整章草稿，补齐身份保留、影响预览与原子保存。
- [章节信息与原文选区划场优化计划](/docs/plans/chapter-source-selection-and-division-plan/)：已完成；五列章节表、默认详情、完整原文框选与 AI 候选逐场确认已落地，附四尺寸和 MySQL 并发证据，不增加跨章节待核对数量、粗剪数量。
- [章节列表与场次抽屉交互优化计划](/docs/plans/chapter-list-and-sequence-drawer-plan/)：已完成；三列章节主表、统一原文保存提示、单层场次管理与浏览恢复已落地，不增加跨章节待核对数量、粗剪数量，附四尺寸验收证据。
- [章节、场次与工作台交互优化任务计划](/docs/plans/chapter-sequence-workbench-interaction-plan/)：已完成；章节直达与详情分区、统一版本、稳定设计三视图和试拍关系图已落地，附最终验收矩阵、证据及检查限制。
- [场次拍摄指令全生命周期与修改体验优化计划](/docs/plans/sequence-instruction-lifecycle/)：默认简洁、业务详情按需展开、技术诊断独立；已支持主动修改、同面板更新、真实预览、采用复检与恢复追溯；T1–T5 已完成，含四尺寸实际页面与验收限制。
- [检查问题处理方向与 AI 修订计划](/docs/plans/sequence-review-ai-revision/)：逐项补充处理方向，统一生成可核对的修改方案，采用后衔接新指令与重新检查；T1–T4 已完成，含概念预览与隔离验收记录。
- [拍摄指令与检查结果可读化计划](/docs/plans/sequence-prompt-readable-view/)：同一份固定指令提供易读视图与模型原文，统一名称、字段和详情展示；T1–T4 已完成，43 项相关测试及两组浏览器回归通过，不改变实际模型输入。
- [本场资产与单元参考输入优化计划](/docs/plans/sequence-asset-reference-input/)：保留场次关联与单元输入边界，统一选图入口，补齐主体分组、资产来源与发送摘要；T1–T4已完成，验证范围与既有检查问题已记录。
- [单元试拍步骤与候选素材工作区优化计划](/docs/plans/sequence-workbench-shoot-flow/)：改为三个可回看的步骤，补齐检查状态与版本命名，合并执行和候选并提供缩略图预览；H1–H4已完成，概念预览、四尺寸实际截图和验证边界已归档。
- [场次工作台紧凑布局与试拍检查优化计划](/docs/plans/sequence-workbench-compact-review/)：压缩顶部重复信息、优先展示待处理检查、按需查看指令，统一三阶段侧栏搜索与公共布局；G1–G3已完成，概念预览、四尺寸实际截图与验收证据已归档。
- [单元试拍操作推进与检查闭环优化计划](/docs/plans/sequence-workbench-shoot-progression/)：让指令、检查结论、执行试拍和候选连续衔接，统一单元状态与主操作；F1–F4完成，已归档概念预览、实际四尺寸截图与验收记录。
- [场次资产准备与设计到试拍衔接优化计划](/docs/plans/sequence-workbench-asset-to-shoot/)：明确资产建档、关联和图片准备的去向，统一确认设计后的试拍入口与单元步骤；E1–E4完成，独立截图、检查结果与验证局限已归档。
- [场次工作台镜头视图与全场关系总览优化计划](/docs/plans/sequence-workbench-scene-overview/)：统一镜头/关系层级及分镜/清单切换，优化分镜密度与顺序，以紧凑节拍行展示全场关系；D1–D4完成，MD验收及独立证据已归档。
- [场次工作台导航、视图与来源优化方案](/docs/plans/sequence-workbench-interaction-refinement/)：在已完成的 A/B 阶段基础上，明确范围与视图职责，优化节拍内操作、可读来源及三个工作空间；C1–C5已完成，MC验收及证据已归档。
- [全站布局统一与场次工作台重设计计划](/docs/plans/frontend-shell-and-sequence-workbench-plan/)：A1–A3、B1–B5 已完成，保留框架规格、参考图及 MA/MB 验收记录。
- [场次工作台体验优化实施计划](/docs/plans/directing-workbench-experience-plan/)
- [场次工作台实施任务与依赖顺序](/docs/plans/directing-workbench-implementation-tasks/)
- [场次创作与试拍剪辑工作台方案](/docs/plans/directing-workbench-refactor-plan/)
- [六部门专业输出契约](/docs/plans/six-department-output-contracts-plan/)
- [异步任务体系简化评估（提案）](/docs/plans/async-task-simplification-assessment/)
- [任务与文件表结构简化方案（提案）](/docs/plans/async-task-schema-simplification/)
- [开发规划](/docs/plans/development-plan/)
- [任务异步化与取消方案](/docs/plans/task-async-cancellation-plan/)
- [Alembic 统一数据库迁移方案](/docs/plans/alembic-unified-migration-plan/)
- [统一资产图提示词模板实施计划](/docs/plans/unified-asset-image-template-plan/)
- [资产结构化与图片提示词改造方案](/docs/plans/structured-asset-prompt-plan/)
- [统一生成编排与独立提示词渲染实施计划](/docs/plans/unified-generation-orchestration-plan/)
- [实验室历史输入回填与重试方案](/docs/plans/experiment-history-retry/)
- [实验室消息与异步生成任务收口计划](/docs/plans/experiment-message-async-generation-plan/)

前期评估依据：

- [六部门与旧工作台的融合评估（已被新方案替代）](/docs/plans/directing-workbench-integration-assessment/)
