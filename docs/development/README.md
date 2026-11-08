# Jellyfish 开发文档

## 开发入口

- [本地开发](guides/local-development.md)、[开发与站点维护 FAQ](guides/developer-faq.md)
- [项目结构](architecture/project-structure.md)、[AI 工作流](architecture/ai-workflow.md)
- [前端说明](guides/frontend.md)、[后端说明](guides/backend.md)
- [OpenAPI 同步](guides/openapi.md)、[供应商注册与扩展](guides/llm-provider-registration.md)
- [接口参考](reference/api.md)、[环境变量](reference/env.md)
- [站点维护](../../site/README.md)

## 开发规范

- [开发规范](standards/development.md)
- [工作台前端设计标准](standards/workbench-design.md)
- [提交规范](standards/commit-convention.md)

## 架构

- [前端基础布局](architecture/frontend-layout.md)

## 开发指南

- [贡献指南](guides/contributing.md)

## 任务、模型与数据库

- [任务执行架构](architecture/task-execution.md)、[运行与排查异步任务](guides/task-operations.md)
- [LLM 默认模型解析](architecture/llm-default-model-resolution.md)
- [数据库迁移与系统种子](architecture/database-migrations.md)、[数据库升级与回退](guides/database-upgrade.md)

## 审查依据

- [代码审查来源索引](standards/review-sources.md)按改动范围指向项目规则、需求依据和验证证据。

## 架构决策

- [独立生成画布的边界与连接契约](adr/0001-independent-generation-canvas.md)
- [生成画布的组件与协议边界](adr/0002-generation-canvas-protocol-boundaries.md)
- [生成画布检查卡的范围与职责](adr/0003-generation-canvas-check-cards.md)
- [声音设计与生成职责](adr/0004-sound-design-and-generation-responsibilities.md)

## 技能配置

- [任务系统](../agents/issue-tracker.md)
- [分诊标签](../agents/triage-labels.md)
- [领域文档位置](../agents/domain.md)

## 场次设计、生产与交付

- [场次生产设计](design/scene-production.md)与[场次工作台架构](architecture/directing-foundation.md)
- [场次素材、剪辑与交付](architecture/directing-edit-delivery.md)与[固定版本及历史素材](architecture/directing-fixed-records.md)
- [接入共享画布 graph](guides/canvas-graph.md)
- [数据模型](reference/data-model.md)与[六部门专业输出契约](reference/six-department-contracts.md)

## 章节划分与场次版本

- [章节划分与场次版本设计](design/chapter-and-scene-versions.md)
- [章节划分架构](architecture/chapter-division.md)与[场次版本架构](architecture/scene-versions.md)
- [接入章节划分历史](guides/chapter-division-history-import.md)与[身份参考存量整理](guides/identity-reference-cleanup.md)
