# Jellyfish Agent Guide

## 适用范围

- 仅执行与本次任务有关的规则；只读审查不要求实现、生成文件或运行构建。
- 本文件维护项目指令入口。技术细则由对应的开发规范和领域文档维护。
- 文档和 skill 按当前问题读取相关章节；已有足够依据时停止扩展读取，当前上下文已有的内容直接复用。

## Agent skills

### UI/UX design

新建界面、大幅视觉改版、设计系统或现有项目约定无法解答的配色、布局、交互问题，使用 [ui-ux-pro-max](.agents/skills/ui-ux-pro-max/SKILL.md)。优先复用现有组件和设计约定；普通 UI 修复与文案修改按现有规范直接处理。

### Grilling

`grill-me` / `grilling` 默认只在对话中澄清问题、收敛决策并确认共同理解。确认共识不等于授权写文件或开始实现；后续动作按用户已有的相应任务授权执行。

`grill-with-docs` 额外按需维护术语表与 ADR，沿用下述 Domain docs 约定。

### Issue tracker

使用任务跟踪、发布规格或拆分票据时，读取[本地任务系统配置](docs/agents/issue-tracker.md)。

### Triage labels

分诊票据时，读取[标签映射](docs/agents/triage-labels.md)。

### Domain docs

讨论领域术语或架构决策时，读取[领域文档布局](docs/agents/domain.md)。

## 开发规范

- 实施或审查代码、接口、文档及验证变更时，读取[开发规范](docs/development/standards/development.md)的适用章节。
- 新增、更新或整理文档时，读取[文档规范](docs/development/standards/documentation.md)，按内容归属和对应流程维护。
- 修改场次工作台的控件、布局、主题或交互时，读取[工作台前端设计标准](docs/development/standards/workbench-design.md)，使用共享组件并按适用范围验收。
- 准备或审查提交说明时，读取[提交规范](docs/development/standards/commit-convention.md)。

## 场次工作台

- 修改章节划分与历史时，读取[章节划分架构](docs/development/architecture/chapter-division.md)；修改方案保存、恢复或复制时，读取[场次版本架构](docs/development/architecture/scene-versions.md)。
- 修改场次页面职责、设计、生产单元、指令或任务来源时，读取[场次工作台架构](docs/development/architecture/directing-foundation.md)和适用的[六部门专业输出契约](docs/development/reference/six-department-contracts.md)。
- 修改 Take、素材审查、剪辑采用、前段依赖或章节交付时，读取[场次素材、剪辑与交付](docs/development/architecture/directing-edit-delivery.md)。涉及旧生产计划及不可变修订时，读取[固定版本与历史素材契约](docs/development/architecture/directing-fixed-records.md)。
