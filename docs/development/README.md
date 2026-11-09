# Jellyfish 开发文档

从[本地开发指南](guides/local-development.md)启动开发环境。产品操作见[官网文档](../../site/content/docs/_index.md)。

## 规范

- [开发规范](standards/development.md)
- [文档规范](standards/documentation.md)
- [工作台前端设计标准](standards/workbench-design.md)
- [提交规范](standards/commit-convention.md)
- [代码审查来源索引](standards/review-sources.md)

## 设计

- [章节划分与场次版本设计](design/chapter-and-scene-versions.md)
- [场次设计、生产与交付设计](design/scene-production.md)
- [场次工作台与共同画布设计](design/shared-canvas-workbench.md)
- [生成画布首版检查项目录](design/generation-canvas-check-catalog.md)
- [ComfyUI 多结果与局部执行调研](design/research/comfyui-canvas-research.md)

## 架构

- [项目结构](architecture/project-structure.md)
- [前端基础布局](architecture/frontend-layout.md)
- [AI 工作流](architecture/ai-workflow.md)
- [章节划分架构](architecture/chapter-division.md)
- [场次版本架构](architecture/scene-versions.md)
- [场次工作台架构](architecture/directing-foundation.md)
- [场次素材、剪辑与交付](architecture/directing-edit-delivery.md)
- [场次固定版本与历史素材契约](architecture/directing-fixed-records.md)
- [资产图片管理架构](architecture/asset-image-management.md)
- [生成准备架构](architecture/generation-workspace.md)
- [生成画布架构与执行边界](architecture/generation-canvas.md)
- [生成实验室架构](architecture/generation-labs.md)
- [LLM 默认模型解析](architecture/llm-default-model-resolution.md)
- [任务执行架构](architecture/task-execution.md)
- [数据库迁移与系统种子](architecture/database-migrations.md)

## 决策记录

- [独立生成画布的边界与连接契约](adr/0001-independent-generation-canvas.md)
- [生成画布的组件与协议边界](adr/0002-generation-canvas-protocol-boundaries.md)
- [生成画布检查卡的范围与职责](adr/0003-generation-canvas-check-cards.md)
- [声音设计与生成职责](adr/0004-sound-design-and-generation-responsibilities.md)
- [场次工作台与自由生成共享画布基础](adr/0005-shared-canvas-foundation.md)

## 开发与维护指南

- [本地开发](guides/local-development.md)
- [贡献指南](guides/contributing.md)
- [前端说明](guides/frontend.md)
- [后端说明](guides/backend.md)
- [OpenAPI](guides/openapi.md)
- [LLM 供应商注册与扩展](guides/llm-provider-registration.md)
- [接入共享画布 graph](guides/canvas-graph.md)
- [运行与排查异步任务](guides/task-operations.md)
- [数据库升级与回退](guides/database-upgrade.md)
- [接入章节划分历史](guides/chapter-division-history-import.md)
- [身份参考存量整理](guides/identity-reference-cleanup.md)
- [资产结构化切换](guides/structured-asset-switch.md)
- [开发与站点维护 FAQ](guides/developer-faq.md)
- [站点维护](../../site/README.md)

## 技术参考

- [接口与 OpenAPI](reference/api.md)
- [数据模型](reference/data-model.md)
- [环境变量](reference/env.md)
- [六部门专业输出契约](reference/six-department-contracts.md)

## 技能配置

- [任务系统](../agents/issue-tracker.md)
- [分诊标签](../agents/triage-labels.md)
- [领域文档位置](../agents/domain.md)
