# Jellyfish Agent Guide

## 适用范围

- 仅执行与本次任务有关的规则；只读审查不要求实现、生成文件或运行构建。
- 本文件是项目规则的唯一维护来源。
- 文档和 skill 按当前问题读取相关章节；已有足够依据时停止扩展读取，当前上下文已有的内容直接复用。

## Agent skills

### UI/UX design

新建界面、大幅视觉改版、设计系统或现有项目约定无法解答的配色、布局、交互问题，使用 [ui-ux-pro-max](.agents/skills/ui-ux-pro-max/SKILL.md)。优先复用现有组件和设计约定；普通 UI 修复与文案修改按现有规范直接处理。

### Grilling

`grill-me` / `grilling` 默认只在对话中澄清问题、收敛决策并确认共同理解。确认共识不等于授权写文件或开始实现；后续动作按用户已有的相应任务授权执行。

`grill-with-docs` 额外按需维护术语表与 ADR，沿用下述 Domain docs 约定。

### Issue tracker

使用任务跟踪、发布规格（`to-spec`）、拆分票据（`to-tickets`）或读取票据时，按 `site/content/docs/guide/agents/issue-tracker.md` 操作本地 `.scratch/<feature>/` 文件。规格与票据属于任务系统，不自动另建站点计划。

### Triage labels

分诊票据时，使用 `site/content/docs/guide/agents/triage-labels.md` 中的五个默认状态。

### Domain docs

讨论领域术语或架构决策时，按 `site/content/docs/guide/agents/domain.md` 使用单上下文术语表与 ADR；文档按需创建。

## 代码规范

修改场次工作台的控件、布局、主题或交互状态时，先按 `site/content/docs/guide/workbench-design.md` 复用共享组件并执行对应验收；例外在变更说明中记录原因与范围。

1. 对外接口契约的同步要求见“接口与文档同步”；内部实现或局部类型调整按实际影响处理。
2. 前端调用后端接口时，统一走 OpenAPI generated client，不再新增手写 service 封装。
3. 本次修改涉及的重复结构具有相同语义，且抽离能降低维护成本时，复用组件或公共样式；不因少量相似样式机械抽象。
4. 后端必须严格区分 `api` 层与 `service` 层职责：
   - `api` 层负责收参、鉴权、响应组织。
   - `service` 层负责业务逻辑、状态流转、数据编排。
5. 新增或修改公共接口、非显然业务规则、复杂函数或类时，注释说明职责、约束与必要的参数/返回值；简单代码优先使用清晰命名，避免复述实现。改动涉及的注释应与实现同步。
6. 生成能力相关的通用契约（输入/输出 DTO、供应商配置等）统一放在 `app/core/contracts`：
   - `tasks` 仅保留任务封装、分派与执行编排，不定义跨层 DTO。
   - `integrations` 仅依赖 `contracts`，不依赖 `tasks` 类型模块。

## 场次工作台数据基础

1. 仅涉及场次工作台时，按需读取 `site/content/docs/architecture/directing-foundation.md` 的相关章节；阶段进展与验收记录以对应计划文档为准。
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

## 接口与文档同步

1. 对外接口路径、参数、响应 schema 或接口语义变化时，同步受影响的后端实现、OpenAPI 和前端 generated client。从项目根目录运行 `pnpm --dir front run openapi:update`；先确认 `127.0.0.1:8000` 对应加载了当前工作区改动的后端，避免从旧进程生成接口。内部类型或局部状态调整未改变对外契约时，不要求重新生成。
2. 当修改使现有文档不准确，或改变已记录的架构、契约、状态语义、页面职责时，同步修订对应文档；普通实现修复不要求新增架构文档。本次工作改变已有计划的范围、优先级或执行路径时，更新该计划。
3. 文档按内容归属维护；目录归属不构成创建文档的要求：
   - `site/content/docs/architecture`：当前真实生效的实现与边界，不混入未来方案。
   - `site/content/docs/plans`：项目正式维护的路线图与阶段计划，新增文档以用户的相应要求为准；稳定落地后将当前事实沉淀到 architecture，按发布需要编写 release note。
   - `site/content/docs/guide`：操作说明、开发流程与接入方式，回答“怎么做”。
   - `site/content/docs/reference`：稳定参考资料，回答“查什么”。
   - `site/content/blog`：release note；未被明确指定时不修改已固化版本。
4. 同一主题的当前事实与未来计划分别放 architecture 和 plans，不混写进 how-to。只读取和更新本次受影响的文档。

## Release Note 规范

仅在新增或明确要求修改 release note 时应用以下规范：

- 必须采用稳定章节结构（按需裁剪，但顺序保持一致）：
  - `Highlights`
  - `Added` / `Changed` / `Fixed`
  - `Breaking Changes`（如有行为或契约变化必须填写）
  - `Deprecations`（如有弃用路径必须填写）
  - `Security`
  - `Known Issues`
  - `Migration Guide`
  - `Rollback Notes`
  - `Compatibility Matrix`
  - `Validation Commands`
  - `Upgrade Checklist`
  - `References`
  - `Notes for Contributors`
  - `Acknowledgements`
- 必须包含 frontmatter：`title`、`date`、`description`、`tags`、`authors`。
- 文风要求：
  - 使用“维护者发布口径”，优先结论与可执行信息，避免冗长叙事。
  - 术语必须稳定一致（如 `shot.status`、runtime task status、`video-readiness`）。
  - 升级步骤、回滚步骤、验证命令必须可直接执行，避免模糊描述。
- 对外可读性要求：
  - 优先短段落与清单化表达；避免重复解释同一事实。
  - 明确区分“新增能力”“行为变化”“兼容风险”“已知问题”。

## 标准完成状态

以下仅适用于本次变更涉及的条目，不要求为无关模块补做工作：

1. 实现满足本次需求；本次引入的占位、无效兼容代码和无用导入已清理，必要注释符合“代码规范”。
2. 涉及接口或文档变化时，已完成“接口与文档同步”；涉及业务页面时，保持上述页面职责、状态语义与主流程。
3. 按变更影响范围完成项目必要检查；所选 skill 明确要求额外验证时一并执行：
   - `front` 的代码、类型或构建配置变化后，从项目根目录运行 `pnpm --dir front run typecheck`。其他前端目录使用各自配置；纯文档或静态资源修改不要求 TypeScript 检查。
   - 后端代码变化后运行相关测试；确无适用测试时，至少完成语法/导入校验并说明验证局限。Python 应用代码或 Pylint 配置变化后，在 `backend` 目录运行 `uv run pylint app`，与现有 CI 对齐。
   - 相同代码与环境状态下已通过的检查复用结果；仅相关修改、失败或新疑点出现时重跑。局部变更运行受影响测试，共享基础设施变化或影响范围不明时扩展到全量测试。
4. 汇报修改内容、验证结果与任何未完成项；无法执行的必要检查应明确列出，不用无关检查代替。
