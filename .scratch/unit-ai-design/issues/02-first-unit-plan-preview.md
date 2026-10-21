# 02: 首次 AI 单元方案生成与预览

Status: ready-for-agent
Blocked by: None
Resolution: completed

**What to build:** 当前镜头尚无单元时，用户点击“AI设计”，选择目标视频模型并开始，一次组织任务返回一个或多个单元的方案供查看；结果出现前后均不改写当前版本。

来源规格：[单元画布 AI 设计与生产单元组织](../spec.md)。

## 前端要求

- 提供统一“AI设计”准备弹窗，只读显示当前镜头，可填写本次要求；无需先建立空单元。没有有效镜头不能开始。
- 首次设计可见地预选有效全局视频默认模型；无有效默认值则要求选择。区分视频目标模型与组织用文本模型，选择不改变全局设置。
- 显示能力加载、失败、重试与必要能力未核实的阻塞状态，只有“开始设计”才提交。
- 展示任务状态、固定依据和完整结果：单元分工、覆盖选择、分段与衔接、参数依据、参考需求和缺项；任务失败或用户关闭预览不改写当前内容。
- 复用既有请求身份与核实原提交交互处理未知响应；越界或无效结果说明原因，不伪装成可用方案。

## 后端要求

- 提供提交、任务读取与结果预览的端到端契约，校验项目、场次、版本和镜头归属，冻结用户当前编辑内容及请求身份。
- 必填目标视频模型，解析真实能力；组织文本模型另行记录。禁止 AI 换模型、编造默认能力或使用模板固定参数冒充真实能力。
- 投影当前镜头的全部适用六岗候选和共享约束，不依赖预先存在的单元选择；一次组织任务完成分段判断和方案生成。
- 结构化结果表达一个或多个单元、稳定的结果身份、执行选择与范围、组织理由和准备缺项；未安排必要内容显式列缺项。
- 校验真实设计身份及适用范围；导演创作变化、其他镜头、跨镜头既有单元、素材与时间线等均受保护，任何越界整份拒绝。
- worker 只保存任务结果、来源与诊断；不写正式单元、不绑定真实参考、不采用素材。相同请求相同输入幂等，不同输入复用身份时冲突。

## 验收标准

- [x] 浏览器从无单元状态完成模型准备、提交和结果预览，分别得到一单元和多单元方案；当前编辑内容与保存内容完全未变。
- [x] 分别验证有效/失效/缺失默认模型、能力加载失败及恢复，不选择列表首项，不修改全局配置。
- [x] 真实 HTTP 与任务生命周期覆盖归属异常、未保存编辑输入、重复请求及未知响应复查。
- [x] 模型输出使用不存在或不适用的条目、擅换模型、增加未设计动作或改写其他镜头时整份拒绝，前端显示可理解的原因。
- [x] 只有参考需求、没有实际文件或落幅的方案保持缺项；任务成功不冒充真实准备完成。
- [x] 使用现有浏览器和后端测试设施，以可控外部模型响应驱动真实业务流程。

## 验证与完成要求

- 使用已确认的真实 HTTP、数据库与任务生命周期测试，以及现有浏览器流程；仅替换外部模型响应。
- 遵循 TDD：逐条验证行为，先看到相关用例失败，再实现并确认通过。复用既有单元范围投影测试入口。
- 前端改动执行项目 typecheck；Python 应用改动执行相关测试及全应用 Pylint；对外契约变化同步 OpenAPI 与 generated client。
- 验证范围与本票变化匹配；完成时记录实际命令、结果和限制，并勾选已通过的验收项。

## 范围与依赖说明

本票完成可独立演示的只读方案生成与预览。明确应用在 03 中交付；不把自动写入或假保存作为预览的临时实现。

规格编号：FE-01、FE-02、FE-03、FE-04、FE-05、FE-06、FE-07、FE-08、FE-11、FE-12、BE-01、BE-02、BE-03、BE-04、BE-05、BE-06、BE-07、BE-09、FA-01、FA-02、FA-04、FA-05、FA-07、FA-13、FA-14、BA-01、BA-02、BA-03、BA-04、BA-05、BA-06、BA-07、BA-08、BA-11。

## Comments

- 2026-10-21：用户调用 implement-spec，按已提出的六张任务及依赖进入实施。


- 2026-10-21 实施：新增当前镜头单元组织任务、明确目标视频模型、适用六岗字段和关系投影、完整结构化只读预览；结果不包含真实参考绑定、指令检查或素材采用字段。任务固定 `task_identity`、用户未保存内容、组织文本模型和视频模型能力；请求身份幂等，未知提交核实原请求。
- 执行范围与进入／结束状态以已有适用设计片段校验；跨多个既有片段可按分号或换行组织。非法设计身份、换模型、新创作、写设计字段、单单元多覆盖整份拒绝；未知时长保留空值和缺项，参考要求自动列为待绑定条件。跨镜头既有单元身份受保护。
- 前端使用工作台共享弹窗与按钮，AI组件置于画布节点外（画布节点会复制渲染），入口投影至主操作区；1440px 与390px截图核验未溢出。任务中心来源增加已验证版本和镜头，回跳展开原方案记录，同一记录关闭后再次回跳亦可展开。
- TDD红灯记录：首次HTTP为404；首次浏览器缺少“AI设计”；部分方案未提示镜头遗漏；参与对象上下文缺失；任务来源缺镜头；多覆盖输出未拒绝；进入状态夹带“突然掏枪”未拒绝；关闭后同一任务再次回跳未展开；模型来源 `task_identity` 缺失。逐项实现后均绿灯。
- 后端验证：`UV_PROJECT_ENVIRONMENT=/Users/extreme/Projects/github.com/jellyfish/backend/.venv uv run --directory backend --no-sync pytest tests/directing tests/services/test_task_queries.py tests/services/test_task_worker.py tests/services/test_task_service.py -q`：454 passed、15 skipped（既有外部环境测试）。后续来源身份变动运行16条相关测试通过；`uv run pylint app`：10.00/10。
- 前端验证：`pnpm --dir front run typecheck`通过；`PLAYWRIGHT_CHANNEL=chrome node front/tests/sceneUnitDesign.browser.mjs`通过，覆盖无／有效／失效默认模型、能力失败恢复、未知POST恢复不重复建任务、单／多单元方案、只读关闭与任务中心回跳。证据：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-KcIBQy`。
- 工作台验收：`PLAYWRIGHT_CHANNEL=chrome pnpm --dir front run test:workbench-ui`通过（共享组件、四画布样式、设计完整性三个浏览器流程）。使用现有共享组件，无设计标准例外。
- 接口：在本worktree实际导入`app.main:app`导出OpenAPI，运行`pnpm --dir front run openapi:gen`同步generated client；主工作区8000为已有用户服务，合入后由集成方确认其reload到新源码再执行正式`openapi:update`，不终止用户服务。
- 验证边界：外部组织模型使用可控响应，不验证真实模型生成质量；本票保持只读，明确覆盖、身份合并与历史移除保护由后续票据03—06完成。

- 最终集成核对：合入票据01所在集成分支后，单元AI组织、场次设计、指令与范围投影33条测试通过；新增“选择合法事件但动作范围不含其主要动作”的红灯并整体拒绝，另以已有凝视辅助表演确认不会误拒合法主要动作方案。仅核对主要动作字段，保留凝视、呼吸等已有辅助表演。


### 最终审查修复（2026-10-21）

- Spec P1 已复现：合法“抬头”范围配合自由参考需求“新增开枪动作并切换枪口特写，必须在视频中呈现”原先未被拒绝。真实 HTTP／任务回归先失败，再由服务端有限类别校验使整份输出失败；失败记录仍可读，预览和应用均拒绝，版本保持原样。
- AI 新增或改写的参考需求仅接受已有主体图片／视频与首帧／尾帧／关键帧参考概念的待准备类别；不使用关键词黑名单或额外模型调用。原有人工参考文字、未改写值及省略继承保留，类别不保证模型已支持或已绑定。待准备参考文字只进入后续 scope.unresolved，不再成为 video constraints；合法参考需求仍生成和展示。
- Standards P2：增加共享 WorkbenchDetails 的“单元设计记录”只读入口；任务回跳进入固定记录，桌面无模态遮罩，可同时缩放画布。记录中点击“比较并应用方案”进入原 WorkbenchModal，准备、差异与一次明确确认流程保持可用。
- 通过：`UV_CACHE_DIR=/tmp/jellyfish-uv-cache uv run --no-sync pytest tests/directing/test_scene_unit_design.py tests/directing/test_unit_scope_projection.py tests/directing/test_instruction_basis.py tests/directing/test_scene_instructions.py -q`（27 项）；`UV_CACHE_DIR=/tmp/jellyfish-uv-cache PYLINTHOME=/tmp/jellyfish-pylint-cache uv run --no-sync pylint app`（10.00/10）；`pnpm --dir front run typecheck`。
- 通过：`PLAYWRIGHT_CHANNEL=chrome node front/tests/sceneUnitDesign.browser.mjs`，包含独立历史、详情打开时真实缩放画布、任务中心与 URL 回跳、桌面及 390px 窄屏、准备及自动／手动保存应用和在途编辑保护。证据：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-HwJjyD`；已目视检查桌面与窄屏截图，标题和关闭入口可达，无横向溢出。8247／4247 独占服务已停止。
- 契约 schema 未变化；同步修正 architecture 对参考诊断与历史容器的描述，不改父规格。完成前 `git merge codex-unit-ai-design` 返回 Already up to date（4a7180e）；集成后的全 directing 检查由集成分支统一执行。
- 浏览器仅出现既有 Browserslist／Tailwind content／Node util 弃用提示。首次复用 venv 时 uv 仅重装本项目 editable 包，无依赖版本变化；后续均使用 `--no-sync`，依赖软链不提交。

- 2026-10-21：本票已合入 `codex-unit-ai-design`；正式 OpenAPI 同步、最终集成回归和两轴审查修复记录统一见[集成验收](../validation.md)。此前委托主集成执行的检查以该记录为准。

- 2026-10-21：后续审查 P2 已修复：长本次要求使用 CanvasTextPreview；真实浏览器红灯后通过折叠／展开及原有保存流程。 修复提交 `5a0f0c1`、`370d4fd`；验证与迁移要求见[集成验收](../validation.md)。
