# 开发规范

## 代码规范

1. 对外接口契约的同步要求见“接口与文档同步”；内部实现或局部类型调整按实际影响处理。
2. 前端调用后端接口时，统一走 OpenAPI generated client，不再新增手写 service 封装。
3. 本次修改涉及的重复结构具有相同语义，且抽离能降低维护成本时，复用组件或公共样式；不因少量相似样式机械抽象。
4. 后端必须严格区分 `api` 层与 `service` 层职责：
   - `api` 层负责收参、鉴权、响应组织。
   - `service` 层负责业务逻辑、状态流转、数据编排。
5. 新增或修改公共接口、非显然业务规则、复杂函数或类时，注释说明职责、约束与必要的参数/返回值；简单代码优先使用清晰命名，避免复述实现。改动涉及的注释应与实现同步。
6. 生成能力相关的通用契约（输入/输出 DTO、供应商配置等）统一放在 `app/core/contracts`：
   - 任务服务负责生命周期编排，Worker 负责领取、执行和报告结果。两者使用共享契约，跨层 DTO 统一由 `contracts` 定义。具体分工见[任务执行架构](../architecture/task-execution.md)。
   - 供应商集成使用共享契约，禁止依赖任务编排层的类型。

## 前端布局

项目工作台等带固定工具栏的页面必须使用 `PageToolbar`、`WorkspaceLayout` 和 `WorkspaceScrollPanel`，组件职责见[前端基础布局](../architecture/frontend-layout.md#路由内容与滚动)。tab 不得依赖父级的 `overflow: hidden` 来裁切自然高度内容。工作台的默认滚动面板不得使用 `overflow: auto`；需要横向浏览的表格、卡片带或代码块必须在自己的局部容器上显式使用 `overflow-x: auto`。

## 接口与文档同步

1. 对外接口路径、参数、响应 schema 或接口语义变化时，同步受影响的后端实现、OpenAPI 和前端 generated client。从项目根目录运行 `pnpm --dir front run openapi:update`；先确认 `127.0.0.1:8000` 对应加载了当前工作区改动的后端，避免从旧进程生成接口。内部类型或局部状态调整未改变对外契约时，不要求重新生成。
2. 当修改使现有文档不准确，或改变已记录的架构、契约、状态语义、页面职责时，同步修订对应文档；普通实现修复不要求新增架构文档。本次工作改变已有任务的范围、优先级或执行路径时，同步对应任务记录。

文档目录职责、内容边界与验证要求见[文档规范](documentation.md)。只更新本次受影响的资料；任务规格与进度沿用项目任务系统。

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
