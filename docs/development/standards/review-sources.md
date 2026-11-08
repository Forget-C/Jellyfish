# 代码审查来源索引

所有路径从仓库根目录解析。本页只负责导航，规则由对应文档维护。

| 何时读取 | 权威来源 |
| --- | --- |
| 每次审查 | `AGENTS.md`、`GLOSSARY.md`、`site/content/docs/community/contributing.md` |
| 提交说明变化或审查提交规范 | `site/content/docs/community/commit-convention.md` |
| 后端实现 | `site/content/docs/guide/backend.md` |
| 前端实现与布局 | `site/content/docs/guide/frontend.md`、`site/content/docs/architecture/frontend-layout.md` |
| 对外接口、响应 schema 或客户端 | `site/content/docs/guide/openapi.md`、AGENTS.md 的接口同步要求 |
| 章节划分与场次版本 | `docs/development/architecture/chapter-division.md`、`docs/development/architecture/scene-versions.md` |
| 场次领域、六岗或生产单元 | `site/content/docs/architecture/directing-foundation.md` |
| 工作台控件、主题、卡片或详情 | `site/content/docs/guide/workbench-design.md` |
| graph、投影、导航、布局缓存或证据 | `site/content/docs/guide/canvas-graph.md` |
| 测试、lint、CI 或运行入口 | `front/tests/README.md`、`front/package.json`、`.github/workflows/frontend-checks.yml`、`front/tests/browser-suites.json` |
| 规格与票据 | `docs/agents/issue-tracker.md`，再定位本任务 `.scratch/<feature>/spec.md` 与票据 |

索引不能代替发现新增规则。搜索文件名时忽略大小写，排除依赖、生成目录和 Git 元数据；将新发现的 CONTRIBUTING、CODING_STANDARDS 和实际适用的规则加入审查输入。

审查者负责核对跨文件语义一致性及测试是否覆盖需求，区分“独立执行”“阅读用例”和“引用既有结果”。新增可机械判断的规则优先接入已有 lint 或确定性回归；不要仅把它追加成审查文字。Lint 基线变更应解释存量问题的减少，不能用重新生成基线接纳本轮新增问题。
