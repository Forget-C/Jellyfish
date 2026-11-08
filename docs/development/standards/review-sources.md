# 代码审查来源索引

所有路径从仓库根目录解析。本页只负责导航，规则由对应文档维护。

| 何时读取 | 权威来源 |
| --- | --- |
| 每次审查 | [项目指令](../../../AGENTS.md)、[术语表](../../../GLOSSARY.md)、[开发规范](development.md)、[贡献指南](../guides/contributing.md) |
| 提交说明变化或审查提交规范 | [提交规范](commit-convention.md) |
| 后端实现 | [后端说明](../guides/backend.md) |
| 前端实现与布局 | [前端说明](../guides/frontend.md)、[前端基础布局](../architecture/frontend-layout.md) |
| 对外接口、响应 schema 或客户端 | [OpenAPI 同步指南](../guides/openapi.md)、[接口同步规范](development.md#接口与文档同步) |
| 章节划分与场次版本 | [章节划分架构](../architecture/chapter-division.md)、[场次版本架构](../architecture/scene-versions.md) |
| 场次领域、六岗或生产单元 | `site/content/docs/architecture/directing-foundation.md` |
| 资产图片、生成准备或实验室 | [资产图片管理](../architecture/asset-image-management.md)、[生成准备](../architecture/generation-workspace.md)、[生成实验室](../architecture/generation-labs.md) |
| 工作台控件、主题、卡片或详情 | [工作台前端设计标准](workbench-design.md) |
| graph、投影、导航、布局缓存或证据 | `site/content/docs/guide/canvas-graph.md` |
| 任务执行、模型解析或数据库维护 | [任务执行架构](../architecture/task-execution.md)、[默认模型解析](../architecture/llm-default-model-resolution.md)、[数据库迁移](../architecture/database-migrations.md) |
| 测试、lint、CI 或运行入口 | `front/tests/README.md`、`front/package.json`、`.github/workflows/frontend-checks.yml`、`front/tests/browser-suites.json` |
| 规格与票据 | `docs/agents/issue-tracker.md`，再定位本任务 `.scratch/<feature>/spec.md` 与票据 |

索引不能代替发现新增规则。搜索文件名时忽略大小写，排除依赖、生成目录和 Git 元数据；将新发现的 CONTRIBUTING、CODING_STANDARDS 和实际适用的规则加入审查输入。

审查者负责核对跨文件语义一致性及测试是否覆盖需求，区分“独立执行”“阅读用例”和“引用既有结果”。新增可机械判断的规则优先接入已有 lint 或确定性回归；不要仅把它追加成审查文字。Lint 基线变更应解释存量问题的减少，不能用重新生成基线接纳本轮新增问题。
