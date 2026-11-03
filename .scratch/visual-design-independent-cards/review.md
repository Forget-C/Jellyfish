# 六类独立画面设计卡：最终审查

固定审查范围：`cce0d11a` → `ce412fd2`。以下保留首次 Standards／Spec 两个轴的原始结论，不以修复后结果覆盖初始发现。所有修复使用既有真实页面、公开保存／编译／预检／执行接口和真实 worker 边界；供应商使用已有替身。

Completion: resolved

## 修复与证据映射

| 轴／发现 | 修复 | 持续回归证据 |
| --- | --- | --- |
| Spec P1：目标读取缓存 text，引用目标错误失效／摘要不变 | 只规范化显式目标字段；稳定来源事实进入目标元信息及依据；只冻结目标字段有效模型引用，不采用运镜正文或携带其媒体 | [公开接口／worker 回归](../../backend/tests/test_generation_canvas_review_regressions.py)：引用目标可用、真实目标修改使成果过期、显示名／片段 ID 不改变语义、目标独占模型来源快照可运行 |
| Spec P1：构图丢失明确对象／镜头／验收关系 | 构图发布器接收 adopted_inputs，保留关系身份、映射和验收依据 | 同一公开回归的对象关系用例；[真实页面关系回归](../../front/tests/generationCanvasDesignRelations.browser.mjs) 同时核对对象／镜头／验收输出 |
| Spec P2：构图／运镜缺高级关系控件，构图缺范围／来源 | 复用 VisualDesignRelations，保留各卡自己的端口及 readonly；构图恢复范围、阶段、条件、来源 | 真实页面从选择到保存、重开、只读、桌面／窄屏；同时验证引用文档定义的目标可被选择 |
| Standards P2：258 个无关生成文件末尾空白变化 | 仅当内容 rstrip 等于 cce0d11a 才恢复原字节；真实契约继续保留 | 审计剩余 baseline terminal-whitespace-only differences = 0 |
| Standards P2：实现索引仍指示未开始 | 索引改为已集成前沿，保留历史规格授权；按最终证据完成集成验收 | [实现索引](issues/README.md) 与各票据完成记录 |
| Standards P3：重复六类类型判断 | Graph 使用已有 isVisualDesign 与每卡局部布尔值；CardEditor 复用 visualDesignTypes | 类型检查和 canvas-design 真实页面回归 |
| 完成记录一致性 | 03 的 Completion 从 complete 统一为 resolved | 九票使用同一完成约定，Status 分诊枚举不变 |

## 验证

- 三个首次公开接口／worker 复现先全部失败（2.10 秒），修复后通过；永久回归扩展为 4 个用例，包含目标独占模型来源的真实 worker 快照。
- `cd backend && uv run --no-sync pytest tests/test_generation_canvas*.py -q`：429 passed，28 skipped，54.31 秒。跳过项为已有可选数据库参数场景；没有调用付费供应商。
- `cd backend && uv run --no-sync pylint app`：10.00/10。
- `pnpm --dir front run typecheck`：通过（Node 24）。
- OpenAPI 从确认加载本工作区的 `app.main:app --lifespan off` 端口 18010 获取，再运行 `pnpm --dir front run openapi:gen`。8000 归属未知，沿用本轮约定不从其生成。生成器格式变化只恢复 baseline 等价内容；相对当前集成提交的 diff --check 会标记恢复的原有末尾空行，这是精确恢复基线的预期差异。
- `PLAYWRIGHT_CHANNEL=chrome pnpm --dir front run test:browser canvas-design`：13/13 真实页面用例通过，包含关系、字段引用、目标、图片／视频携带、三个静态设计、预设、A 编辑器、旧摄影清理及导演 Modal。新增关系用例先因缺少控件失败，恢复后通过。
- 原模型消费者三个既有用例 `generation-canvas-model-card-shell`、`generation-canvas-material-composer`、`generation-canvas-video-bindings` 逐项通过（11.3／16.7／13.5 秒）；使用相同 test:browser 命令可单独复现。08 新增携带模型 fixture 与既有 composer 自建模型发生 ID 冲突，已为新增 fixture 使用专有 ID；最终携带视频复跑通过（13.6 秒）。
- 六类字段引用用例的全局 keyboard 输入在切换高级设置后出现焦点竞争，改为对目标 textbox 执行按键；公开字段输入行为保持不变，完整用例通过（41.2 秒）。
- 最终稳定截图／日志／结果：`/private/tmp/jellyfish-visual-design-final-review-evidence`。持久证据同时包括仓库内公开回归及浏览器用例、以上命令和结果；临时路径不是唯一验证依据。
- 258 个审查指出的无关末尾空白差异已精确恢复；审计相对 cce0d11a 的末尾空白独占差异为 0。

## 首次 Standards 审查（原文）

# Standards review

Scope: `git diff cce0d11a...HEAD`, HEAD `ce412fd23394adb4fe911518c42b314c75a73931`; commits from `git log cce0d11a..HEAD --oneline` (01–09 and integration merges). Read-only review; no implementation or test reruns.

## Findings

1. **[P2, documented scope rule] Restore unrelated generated whitespace.** Exactly 258 existing files under `front/src/services/generated/` differ only in terminal whitespace. Example `models/AIRequest.ts:14`: the entire diff is deletion of the blank line after `};`. These files contain no changed feature contract. This violates the user's AGENTS instructions, “精准修改：仅修改与当前任务直接相关…不顺手优化…排版格式.” Restore only files whose old/new contents match after stripping terminal whitespace; retain real schema/client changes. Complete audited list is in `/private/tmp/jellyfish-ticket08-notes.md`; count independently confirmed against the fixed point.

2. **[P2, documented synchronization rule] Update the implementation index to its actual state.** `.scratch/visual-design-independent-cards/issues/README.md:3` still says “当前仅发布票据，未开始实现”, and line23 says “现在可开始的是01”, although all nine tickets now record `Completion: resolved`. AGENTS.md “接口与文档同步” item2 requires revising documentation made inaccurate by implementation. Record the integration branch, completed frontier and final integration verification rather than directing another agent to start01. Do not rewrite the historical parent spec’s publication authorization.

3. **[P3, judgement: Repeated Switches / Duplicated Code] Reuse the existing six-type predicate.** `GenerationCanvasGraph.tsx:1190–1241` repeatedly spells the same six-type `.includes(card.type)` list; `CanvasCardEditor.tsx:27,190` repeats it for layout flags and height. `designFieldReferences.ts` already exports `visualDesignTypes` and `isVisualDesign`, imported by Graph. Quote: `['direction.movement', 'direction.composition', 'direction.style', 'direction.camera', 'direction.lighting', 'direction.focus'].includes(...)`. Use the existing predicate/list for these same-semantic checks and local booleans for repeated per-card decisions. This reduces already duplicated policy without adding an abstraction. AGENTS.md code rule3 favors reuse for same-semantic repeated structure; this smell is a maintenance judgement, not a claim of incorrect current runtime behavior.

Summary: 2 documented-rule findings, 1 judgement smell. No additional actionable standards violation established; functional/spec coverage belongs to the independent Spec axis. Tool-enforced formatting/type/lint concerns were excluded.

## 首次 Spec 审查（原文）

# Spec review — ce412fd2 vs cce0d11a

Read-only review; repository remains clean. Three actionable findings; no unrequested scope found in inspected carry, snapshot, direct-candidate eligibility, video-use and retirement paths.

1. **[P1] Frame targets read cached text rather than authoritative reference documents.** Spec L147 permits explicit movement-state targeting; L156 requires “设计引用…变化参与依据摘要和预检过期判断”. `backend/app/services/generation_canvas/composition.py:47` checks `frame.text`; `backend/app/core/contracts/generation_canvas.py:476` narrows the resolved target to `DesignField`, discarding its document. Public HTTP repro: a valid reference-only movement phase appears in movement `frame_states`, but a composition targeting it reports `available:false` / `DESIGN_FRAME_TARGET_MISSING`. A real worker run followed by changing only target document text A→B leaves the consumer `basis_current:true`. `front/src/pages/aiStudio/generationCanvas/CompositionEditor.tsx:15` also hides such valid states. Normalize the explicitly targeted state, track its effective reference dependencies, and preserve the boundary against adopting unrelated movement body/media.

2. **[P1] Composition drops explicitly adopted object/shot/acceptance relationships.** Spec L103 requires “现有作用范围、来源、对象关系及必要的专业参数按卡片真实职责保留”. `backend/app/services/generation_canvas/outputs.py:28` calls `publish_composition` without adopted inputs; `composition.py:10` never consumes them. Public save accepts an `effect_object` binding and real object edge for 张三, but composition outputs contain `objects:[]`, no relationship text or reference identity. The declared input ports therefore silently discard user configuration; shot/acceptance inputs share this path.

3. **[P2] Advanced settings omit retained relationship controls.** Spec L103 above and L109 (“高级设置是本卡文本与必要结构控件”) require preserved structural configuration. `front/src/pages/aiStudio/generationCanvas/CompositionEditor.tsx:22` omits scope/source controls and existing object, shot and acceptance selectors; `MovementEditor.tsx:15` also omits those relationship selectors. These controls existed in the original photography editor and remain in `StaticVisualDesignEditor`; users cannot configure the corresponding declared inputs in the new editors.

Evidence: `/private/tmp/jellyfish-spec-review/test_review.py` contains three public HTTP/worker reproductions; all three fail against this integration tip (2.14s). Run from backend with `PYTHONPATH=$PWD UV_CACHE_DIR=/tmp/jellyfish-uv-cache uv run --no-sync pytest /private/tmp/jellyfish-spec-review/test_review.py --rootdir=/private/tmp/jellyfish-spec-review --confcutdir=/private/tmp/jellyfish-spec-review -q -s`.

## 最终独立复核

复核集成提交：`69c26f9e`，基线：`cce0d11a`。

- Standards：2 项规范问题与 1 项维护判断均已关闭；独立审计确认生成文件纯尾部空白差异为 0，索引和复用判定已核对。
- Spec：3 项发现均已关闭；在最终集成工作区重新运行未修改的原始公开接口／worker 复现，3/3 通过（1.99 秒）；目标独占上游模型来源的固定快照回归另行复核，1/1 通过（0.38 秒）。关系真实页面日志、结果和桌面／窄屏截图已复核，复用其通过结果。
- 九张票据均为 `Completion: resolved`，各票和五项集成验收清单无未完成项，票据链接有效。最终基线三点差异空白检查通过。
- 独立复核记录：`/private/tmp/jellyfish-standards-verification.md`、`/private/tmp/jellyfish-spec-verification.md`。正式回归用例及稳定证据索引保留在本记录和票据中。
