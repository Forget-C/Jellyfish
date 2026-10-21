# 01: 局部单元按所选范围编译与审查

Status: ready-for-agent
Blocked by: None
Resolution: completed

**What to build:** 用户在现有单元编辑中只选择已有动作“抬头”，保存后生成并审查指令时，本次执行不再被完整镜头“拆信、读信、抬头”重新扩大。

来源规格：[单元画布 AI 设计与生产单元组织](../spec.md)。

## 前端要求

- 现有动作范围、执行项选择、指令建议与当次依据展示能共同表达本次局部执行，保存刷新后保持一致。
- 共享约束和必要连续性要求继续展示；依据变更沿用现有状态，不自动显示已确认或已检查通过。
- 复用现有控件与页面职责，不把创作意图、视点或新动作改写开放为单元组织权限。

## 后端要求

- 修正完整镜头可见结果与单元实际执行范围的投影关系，供指令生成、依据核对与审查一致使用；完整镜头可以解释背景，不能无条件变为每个单元必须完成的动作。
- 本次动作范围与所选节拍、事件、表演动作、镜内活动和连续性项共同约束执行，仍校验真实身份和适用性；不能靠忽略所选设计条目实现表面缩小。
- 保留适用的共享约束。完整镜头执行仍能正确表达；新规则不得重算或改写历史固定输入和已经发生的检查记录。

## 验收标准

- [x] 通过现有浏览器流程建立同镜头的两个局部单元，选择不同动作并保存刷新，各自指令依据互不扩大。
- [x] 真实 HTTP/任务流程验证“只拍抬头”的编译输入与审查不重新要求拆信、读信；共享身份、空间与连续性约束仍存在。
- [x] 覆盖完整镜头执行、相关依据变更与历史任务读取，证明没有把所有镜头结果直接删除后留下新的语义缺口。
- [x] 检查依据变化只影响当前适用性，不自动确认新依据、不改写旧指令来源或任务快照。

## 验证与完成要求

- 使用已确认的真实 HTTP、数据库与任务生命周期测试，以及现有浏览器流程；仅替换外部模型响应。
- 遵循 TDD：逐条验证行为，先看到相关用例失败，再实现并确认通过。复用既有单元范围投影测试入口。
- 前端改动执行项目 typecheck；Python 应用改动执行相关测试及全应用 Pylint；对外契约变化同步 OpenAPI 与 generated client。
- 验证范围与本票变化匹配；完成时记录实际命令、结果和限制，并勾选已通过的验收项。

## 范围与依赖说明

可直接基于现有手动单元和指令流程独立交付，无须等待 AI 组织接口。

规格编号：FE-12、HP-03、HP-09、FA-12、BA-14、BA-19。

## Comments

- 2026-10-21：用户调用 implement-spec，按已提出的六张任务及依赖进入实施。


### 票据 01 实施与验证

- 2026-10-21：单元投影升级为第三版。所属镜头的完整可见结果保留在解释背景，实际执行只消费动作范围及真实选择条目；仍保留适用人物、空间、连续性及共享规则。编译与审查明确区分完整镜头上下文和当次执行。
- 历史第一、二版依据、建议及检查按原投影比较；历史建议采用后的回执保留模型当时消费的冻结投影，当前依据及新任务使用第三版。没有改写已有任务输入、来源或回执。
- 前端继续复用已有单元编辑和依据展示。新增浏览器验收实际建立同镜头两个单元、分别选节拍、保存刷新，并通过真实依据接口验证各自执行互不扩大。
- TDD：先在真实依据接口复现完整镜头错误进入执行项；再修复并通过。另先复现历史建议采用后的回执被错误记录为第三版，再保留原投影并通过。
- 通过：`pytest tests/directing/test_instruction_basis.py tests/directing/test_instruction_checks.py tests/directing/test_scene_instructions.py tests/directing/test_instruction_destinations.py tests/directing/test_scene_video.py tests/directing/test_scene_copy.py tests/directing/test_unit_scope_projection.py -q`（40 项；随后增加的历史采用断言由 `pytest tests/directing/test_scene_instructions.py -q` 再次验证，3 项通过）。
- 通过：`PLAYWRIGHT_CHANNEL=chrome node front/tests/sceneUnitExecutionScope.browser.mjs`；真实浏览器与隔离数据库，证据目录 `/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-ffdOfE`。
- 通过：`pnpm --dir front run typecheck`；`uv run --no-sync pylint app`（10.00/10）。复用主工作区已安装依赖，未联网安装。
- 外部模型响应使用确定性替身；不调用真实供应商，不验证供应商实际视频遵从性。现有浏览器提示 Browserslist 数据较旧、Tailwind content 配置及 Node util 弃用，不影响本票验收。
- 最终全范围复核通过：`uv run --no-sync pytest tests/directing -q`：438 项通过、15 项按现有环境条件跳过，耗时 117.51 秒。历史采用修复后再次运行全应用 Pylint，仍为 10.00/10。
- 报告前执行 `git merge codex-unit-ai-design`，结果为 Already up to date。

- 2026-10-21：本票已合入 `codex-unit-ai-design`；正式 OpenAPI 同步、最终集成回归和两轴审查修复记录统一见[集成验收](../validation.md)。此前委托主集成执行的检查以该记录为准。
