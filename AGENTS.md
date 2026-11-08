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
- 修改场次工作台的控件、布局、主题或交互时，读取[工作台前端设计标准](docs/development/standards/workbench-design.md)，使用共享组件并按适用范围验收。
- 准备或审查提交说明时，读取[提交规范](docs/development/standards/commit-convention.md)。

## 场次工作台数据基础

1. 仅涉及章节划分或场次版本时，按需读取[章节划分架构](docs/development/architecture/chapter-division.md)或[场次版本架构](docs/development/architecture/scene-versions.md)。场次生产与工作台其余边界见[场次核心架构](site/content/docs/architecture/directing-foundation.md)。
2. 新场次数据统一通过 `app.services.directing.store.DirectingStore` 读写；不得绕过类型、项目归属、版本与文件引用校验直接更新 JSON。
3. `Sequence` 表示故事场次，`Scene` 仍是场所资产。GenerationUnit 身份为生产计划版本与 unit_id，Take 不绑定唯一镜头。
4. 已确认版本不可原地改写；预演预计时长和真实媒体区间、素材审查与剪辑采用必须分开。
5. 旧 Shot、ShotDetail 及镜头槽位生成入口已移除，不恢复旧状态、双写或兼容别名。
6. 候选不自动采用，预演不代表实际覆盖，样片动作偏差不等于计划已覆盖。
7. 前段依赖绑定历史计划版本、实际落幅及参考；采用替换仅使有关依赖和接缝待复核。

## 前端页面职责与主流程

1. 项目工作台负责章节原文、项目资产和项目风格；章节原文按故事段落确认场次。
2. 场次设计视图负责六岗设计、来源、预计镜头和版本确认；镜头是设计中的计划条目，不是旧 Shot 表。
3. 场次试拍视图负责生产单元、参考素材、提示词编译与审稿、模型能力预检、单次或批量拍摄。
4. 场次剪辑与验收视图负责 Take 实际覆盖、可用区间、人工采用、接缝与整场审片、局部返工。
5. 章节组合只消费各场已确认的粗剪；预演缺口、真实媒体、声音待后期分别显示。
6. 任务中心只展示通用状态、进度、取消与业务回跳。提示词、来源映射、诊断等专属上下文留在场次业务页。
7. 标准顺序为：新建项目 → 添加章节原文 → 确认场次 → 六岗设计与确认 → 准备资产/参考及生产单元 → 编译审稿 → 拍摄 → 审片采用与粗剪 → 局部返工。
8. 设计/计划确认、运行时任务状态、生成准备度、素材审查和剪辑采用分别表达。生成成功只登记 Take，不自动采用；不使用旧 shot.status 判定新流程。
