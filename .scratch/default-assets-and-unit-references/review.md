# 默认资产与单元参考解耦两轴审查

日期：2026-10-22

使用 code-review 工作流，两位独立审查代理分别检查 Standards 与 Spec。固定基点为 `0f552b38027162efb4bd05ffa9408ccbb5cc7d37`，初审 HEAD 为 `6041c0a93b16a23c28690410c800fb73ed12f714`；diff 为 `git diff 0f552b38027162efb4bd05ffa9408ccbb5cc7d37...HEAD`。以下保留原始发现，不因后续修复删除初审结论。

## Standards

- [P2] 新增工作台动作应使用共享按钮（明确规则违反）。`front/src/pages/aiStudio/directing/ReferencePicker.tsx:158–161,179–180` 为“更换来源”“撤回选入”“取消更换来源”直接使用 AntD `Button`。此弹窗由 `SceneUnitCanvas` 在实际工作台中以 `canvas-workbench-dialog` 挂载。`AGENTS.md`“代码规范”要求修改工作台控件时复用共享组件；`site/content/docs/guide/workbench-design.md` 开发顺序及共享组件表明确要求动作使用 `WorkbenchButton`，例外须记录原因、范围及验证。本次记录未说明这些新动作的例外；旧组件已有 AntD 按钮不构成新增动作豁免。对工作台实例使用 `WorkbenchButton`（取消使用 quiet 层级），保留浅色调用场景原有按钮。

未发现值得单列的 baseline smell。只读审查，未修改源文件或运行测试。

### 复核

Standards remaining findings: 0.

Rechecked integration HEAD 4b7fc7928fbdcf0207ea1a4e6dcef825f7ce2bad, changes since 6041c0a93b16a23c28690410c800fb73ed12f714, against the original review rules and baseline.

Original button finding is resolved: ReferencePicker.tsx:21 selects WorkbenchButton only for WorkbenchModal; new source/withdraw actions at lines 160 and 181 inherit its default secondary variant, and cancellation at line 182 uses quiet only in workbench context. Light context keeps AntD Button and receives no variant prop. No new documented-standard regression found in the fix; service logic remains in DirectingStore and changed normal-open semantics are documented. Root owns pending final OpenAPI description regeneration and verification.

Read-only source review; no broad tests run. Original report retained.

## Spec

- **[P2] Wire the existing-data cleanup into an automatic, controlled execution path.** `backend/app/services/directing/store.py:354–358` adds only an explicitly invoked cleanup operation; its sole production caller is the new HTTP route. Neither scene-version reads nor saves nor the workbench invokes it. Meanwhile `store.py:653–654` immediately rejects the old groups on every ordinary save. The authoritative spec, line 267, explicitly says: “自动清理既有可编辑不合规数据，而非保留到用户手工整理”; line 29 likewise requires “既有可编辑单元中的不合规身份参考按确定规则自动清理”. A migration/controlled automatic trigger is missing; the manual administrator instructions in `reference-cleanup.md` do not implement that behavior. In an isolated real HTTP/database reproduction, an existing unit with two identity groups for one participant remained unchanged after GET (`r1`, `r2`); saving an unrelated participant-name edit then returned HTTP 422 (“同一人物或物件只能使用一个身份主体组及单一素材来源，请更换整组来源”). Thus legacy projects remain blocked until someone manually discovers and calls the maintenance API. Automatically process the saved baseline within the authorized editable-data boundary, while continuing to reject illegal new submissions and preserve frozen evidence.

No additional proven unasked scope or incorrect-behavior findings. Read-only review; reproduction used a temporary database and no model calls.

### 复核

Remaining findings: **0**. Original P2 automatic-cleanup finding is resolved at HEAD `4b7fc7928fbdcf0207ea1a4e6dcef825f7ce2bad`.

Verified the actual initial workbench path: `CanvasSequenceWorkbench.tsx:507` calls the normal version collection API; that route now calls `open_scene_versions`, which invokes `open_scene_version` before any canvas projection. The detail GET uses the same opening boundary. Cleanup processes only the saved server baseline under revision CAS, skips retired sequences, and preserves internal snapshot reads and explicit rejection of illegal new submissions. Unchanged content remains a true no-op; automatic opening retries a bounded number of CAS races against a newly read baseline.

The added real HTTP regression covers both collection and detail opening, verifies only the first valid original reference survives, all five canvas graphs use the cleaned revision, repeated reads remain unchanged, and an unrelated name edit subsequently saves successfully. The browser regression explicitly waits for the actual collection GET during workbench opening, checks the automatic cleanup and graph revision, and asserts no manual cleanup request occurred. Existing frozen tasks, Takes and confirmed revision evidence remain outside the changed path.

Reviewed the reported independent regression evidence (`553 passed, 15 skipped`, final targeted HTTP checks, browser results) and source assertions; no redundant broad rerun. No new spec defect identified in the fix. Original report retained unchanged at `/tmp/jellyfish-default-assets-review-spec.md`.

## 修复与结项

两项 P2 均由同一个实现代理在独立工作区修复，提交 `0e6b9268babe2ccd2651bd56cf76cb3e0dcb97d5`，合并为 `4b7fc7928fbdcf0207ea1a4e6dcef825f7ce2bad`。正常 LIST／GET 已在投影前受控整理保存基线；内部读取和新输入拒绝保持分开；新增来源动作使用共享 secondary／quiet 层级。并发、有变化／无变化、回滚与历史边界均补齐真实 HTTP 验证。

根代理随后从已核实的当前正式 8000 app.main 重新生成 OpenAPI/client，补齐正常读取语义描述；生成差异仅含描述。最终检查及证据见[验收记录](acceptance.md)。原始规格未改。

审查汇总：Standards 初审 1 项（最严重 P2），复核 0 项未解决；Spec 初审 1 项（最严重 P2），复核 0 项未解决。未合并或重新排列两个轴的结论。
