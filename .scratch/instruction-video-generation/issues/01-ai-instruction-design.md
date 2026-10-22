# 01: AI 设计起草、预览与应用指令

**What to build:** 用户从单元画布进入同一单元的指令画布，通过顶部“AI 设计”完成整体或选段起草、预览差异、明确应用和后续修改，已有内容及未保存工作受到保护。

**Blocked by:** None

**Status:** ready-for-agent

**Spec:** [AI 指令起草与参考媒体视频生成链路](../spec.md)，实施决策 1–3、10；验收 A01、A02、A03，以及本流程涉及的 A19、A20。

## Acceptance criteria

- [x] 单元画布直接起草指令的快捷入口改为“进入指令画布”；保留明确选中的同一单元及当前编辑内容，导航不提交任务、不创建对象。
- [x] 准备未齐也能进入查看，实际起草继续执行原有硬门槛；单元画布自身的 AI 设计继续负责组织生产单元。
- [x] 指令画布顶部固定“AI 设计”，工作区明确当前单元、整体或选段范围及可选要求；要求留空时仍可使用已准备的资料起草。
- [x] 打开工作区不提交任务，点击“生成指令”才提交；现有设计、执行范围、风格、参数及参考绑定信息按原规则进入固定输入。
- [x] 建议和差异先预览，明确应用后才成为当前指令；重新起草在应用前保留原指令，应用后返回画布并可继续修改。
- [x] 整体和选段修订保留正确范围；生成期间指令、相关依据或版本变化时，旧建议不能覆盖新内容。
- [ ] 使用“修改指令”等明确文案，章节原文继续由项目工作台维护；不新增视频模型专属提示词策略或图片、视频理解能力。
- [x] 保留应用撤销、任务恢复和原请求核实；用户已离开工作区时，任务完成只提示并提供返回入口，不抢占位置。
- [x] 键盘、只读、窄屏、焦点恢复和弹窗开合符合工作台约定，未保存内容及画布视口不因浏览丢失。
- [x] 完成对应浏览器及场次 HTTP 回归、受影响类型检查和必要的契约与文档同步。

## Validation

- 复用指令建议、局部修订和工作台导航用例，通过真实浏览器连接测试后端验证提交、预览、应用、取消和撤销。
- 核对保存后内容、实际请求次数及单元隔离，包含起草前准备不足、可选要求为空、任务期间继续编辑和离开页面的场景。
- 本票覆盖指令形成流程；当前指令卡的检查及视频动作由 02 负责。

## 完成记录（2026-10-22）

- 01 独立实现完成；分诊状态保留 `ready-for-agent`。当前指令卡“修改指令”文案由 02 共同交付，该项待集成核对，其余本票行为已验收。
- 单元快捷入口仅导航；指令顶部 AI 设计复用现有建议逻辑和 `WorkbenchModal`，提交、差异预览、应用、取消及原请求核实均在弹窗内完成。应用后返回画布，拒绝时焦点留在可见原因；打开时任务读取尚未完成也能随后显示原任务。
- 工作区开合状态用于同单元后台通知，关闭后的完成结果不重开弹窗。原准备、依据和六岗硬门槛未改。未变更 API，不需重新生成 OpenAPI；未修改 Python 应用代码，不触发 Pylint。
- 同步当前架构描述；迁移旧建议、准备、主入口、图证据和视频测试的受影响入口，并增加可重复运行的 `instructions` 浏览器套件。

### 红绿与验证证据

- 浏览器真实连接测试后端，未调用真实模型。先后观察到导航入口缺失、应用后弹窗未关闭、同单元后台完成通知缺失、应用拒绝后焦点丢失、早于任务列表读取打开时原任务未显示的红灯，逐项实现并转绿。
- `PLAYWRIGHT_CHANNEL=chrome node front/tests/sceneInstructionDesign.browser.mjs`：通过；覆盖导航不提交、准备硬门槛、空要求、预览应用、手工修改和撤销、后台通知及冲突拒绝、只读、键盘、标题视口边界和 1440/390 布局。截图与日志目录：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-IOCd45`（桌面和窄屏截图已目视检查）。
- `PLAYWRIGHT_CHANNEL=chrome node front/tests/sceneInstructionPrimary.browser.mjs`：通过；原任务浏览与准备不足保持草稿，未重复提交。证据目录：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-KB7QuD`。
- `PLAYWRIGHT_CHANNEL=chrome node front/tests/sceneInstructionSuggestions.browser.mjs`：通过；原请求恢复、刷新、存储失败、取消、Unicode 选段、越界拒绝、撤销、跨单元通知和失效目标保护。证据目录：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-ovboqW`。
- `PLAYWRIGHT_CHANNEL=chrome node front/tests/sceneInstructionPreparation.browser.mjs`：通过；缺项定位和能力核实硬门槛。证据目录：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-9qwxOo`。
- `PLAYWRIGHT_CHANNEL=chrome node front/tests/sceneInstructionEvidence.browser.mjs`：通过；同修订证据刷新保留输入和焦点。证据目录：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-r4XHIX`。
- `UV_CACHE_DIR=/tmp/jellyfish-uv-cache uv run --no-sync pytest tests/directing/test_scene_instructions.py -q`（backend）：4 passed。
- `pnpm --dir front run typecheck`、`git diff --check`：通过。
- 根实施者明确统一在 03/04 等票据合入后运行 `PLAYWRIGHT_CHANNEL=chrome pnpm --dir front run test:workbench-ui`；本票未重复运行中间树的整套工作台回归。真实视频模型验收由 08 负责。
