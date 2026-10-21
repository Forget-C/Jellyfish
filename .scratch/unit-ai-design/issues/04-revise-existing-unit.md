# 04: 既有单元 AI 局部修改并保留身份

Status: ready-for-agent
Blocked by: 03
Resolution: completed

**What to build:** 用户明确选择已有单元，在同一个“AI设计”入口提出执行调整，预览并确认后修改该单元，其他内容和历史依据继续保留。

来源规格：[单元画布 AI 设计与生产单元组织](../spec.md)。

## 前端要求

- 多个单元时按稳定身份明确选择目标，通过统一准备弹窗填写要求，显示完整镜头方案中的保留项与修改项。
- 沿用模型能力准备、差异预览和一次确认；生成或预览期间相关手工修改使结果失效，旧建议不能覆盖新内容。
- 应用后可以继续局部手动编辑；指令依据已变与准备缺项分别显示，创作层变化说明应先到导演画布处理。

## 后端要求

- 冻结明确目标单元及当前镜头单元方案，同时提供该镜头其他适用设计候选；不根据自然语言序号猜测目标，也不局限于旧单元已选条目。
- 同一单元局部修改保留单元及仍有效覆盖项身份；原样保留的单元保留原配置，实际重新设计的单元使用用户本次目标模型。
- 保留未授权修改的指令、真实来源、参考和依赖，AI 缺省字段不清空；依据改变不自动继承旧检查通过。
- 对输出的执行条目与动作语义进行范围校验；未经设计的新动作、视点、情绪或镜头目的不得通过自由文字混入。
- 保持历史任务、Take 和检查固定依据。若修改涉及移除被当前设计或实际覆盖引用的覆盖项，沿用真实引用校验阻止整份应用。
- 此票支持保留原单元集合的局部修改；新增补拍与单元级拆并移除分别由后续票据完成。

## 验收标准

- [x] 两个既有单元中只调整明确目标，确认后目标身份稳定，另一单元及其他镜头逐项保持。
- [x] 结果缺省指令、来源、真实参考或依赖字段时，应用后这些字段仍存在且指向原真实依据。
- [x] 编辑动作范围和执行选项后，下游指令与检查只针对新局部执行，旧检查不冒充新要求已通过。
- [x] 相关来源或目标内容改变后应用被拒绝；独立镜头编辑不受影响。
- [x] 新故事事实、非法引用和涉及受保护覆盖项的修改整体拒绝，并在现有预览中解释原因。
- [x] 覆盖真实 HTTP 保存回读及浏览器操作，不新增独立修改入口。

## 验证与完成要求

- 使用已确认的真实 HTTP、数据库与任务生命周期测试，以及现有浏览器流程；仅替换外部模型响应。
- 遵循 TDD：逐条验证行为，先看到相关用例失败，再实现并确认通过。复用既有单元范围投影测试入口。
- 前端改动执行项目 typecheck；Python 应用改动执行相关测试及全应用 Pylint；对外契约变化同步 OpenAPI 与 generated client。
- 验证范围与本票变化匹配；完成时记录实际命令、结果和限制，并勾选已通过的验收项。

## 范围与依赖说明

依赖 03 的应用与冲突保护，不依赖新增补拍。不得以本票为由重规划导演画布的创作性局部修订。

规格编号：FE-02、FE-03、FE-07、FE-08、FE-10、FE-11、FE-12、BE-01、BE-03、BE-05、BE-07、BE-08、BE-09、HP-01、HP-03、HP-04、HP-05、HP-09、HP-10、FA-09、FA-12、FA-13、BA-01、BA-07、BA-08、BA-09、BA-12、BA-19、BA-20。

## Comments

- 2026-10-21：用户调用 implement-spec，按已提出的六张任务及依赖进入实施。



### 票据 04 实施与验证

- 2026-10-21：单元画布当前稳定身份以可选 `request.source_unit_id` 进入统一“AI设计”任务；弹窗只读呈现所选单元，使用其有效视频模型作为本次预选，不增加操作模式或独立 AI 修改入口。多个既有单元尚未明确选择时不能开始。
- 结果以 `operation=retain/modify/create` 明确保留、修改与新建；省略标记仅兼容既有任务结果。明确修改即使只有视频模型变化也使用本次目标模型；保留项不迁移模型或其他配置。目标稳定身份与仍有效覆盖身份保留，其他镜头和跨镜头单元不会被误替换；本票不支持单元拆并移除。
- 只替换明确组织字段，保持原指令、真实来源、参考、参数、历史依赖、依据与检查身份。进入／结束状态与参考要求的 nullable 建议在真实任务序列化后仍区分省略和明确清空，不依赖 `model_fields_set`。执行范围变化后原固定依据仍可读取，并由既有状态表达“依据已变”。
- 预览与确认复用完整候选组合及真实存储引用校验，当前设计引用的覆盖项不能被静默替换；非法动作、设计引用、未选单元修改和虚假 retain/create 标记整体失败。相关目标、参考、参数、依赖变化拒绝旧结果，独立镜头最新指令保留。
- TDD：先复现 `source_unit_id` 不被接受（422），实现后继续复现非末位目标应用成功但首次保存误判过期（409）；按原相关单元顺序还原后通过。另先复现结果 `operation` 不被接受及受引用覆盖项预览仍返回 200，再分别实现显式结果语义与完整候选预览校验。浏览器先复现所选目标未呈现超时，再完成目标传递、模型预选、差异预览、取消、确认、保存回读、刷新与后续人工修改／过期保护。
- 通过：backend 目录 `UV_CACHE_DIR=/tmp/jellyfish-uv-cache uv run --no-sync pytest tests/directing/test_scene_unit_design.py tests/directing/test_scene_unit_supplement.py tests/directing/test_scene_versions.py tests/directing/test_unit_scope_projection.py tests/directing/test_instruction_basis.py -q`，43 passed（最终 12.36 秒）。包含与票 05 协作共享的补拍准备及真实拍摄闭环回归；票 05 自行记录其验收。
- 通过：backend 目录 `UV_CACHE_DIR=/tmp/jellyfish-uv-cache PYLINTHOME=/tmp/jellyfish-pylint-cache uv run --no-sync pylint app`，10.00/10；项目根 `pnpm --dir front run typecheck`。
- 通过：`PLAYWRIGHT_CHANNEL=chrome node front/tests/sceneUnitRevision.browser.mjs`（独占 8244/4244）与 `PLAYWRIGHT_CHANNEL=chrome node front/tests/sceneUnitDesign.browser.mjs`（原首次流程）。局部修改桌面／390px 窄屏截图已目视检查；窄屏确认按钮在视口内且无横向溢出。最终局部修改证据 `/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-7aVqok`；首次流程证据 `/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-Z8Gzuf`。
- OpenAPI 从本工作树 `app.main.app.openapi()` 导出，精确相等核对通过；执行 `pnpm --dir front run openapi:gen`，仅保留实际契约差异及原有序列化风格。统一正式 `openapi:update` 和主 8000 服务来源核实由最终集成执行。
- 复用 WorkbenchModal、WorkbenchButton 与原工作台保存／详情组件，无共享样式或布局例外。全套工作台 UI 检查按集成安排于票 06 后统一执行，复用票 03 现有共享组件验收。
- 限制：仅外部模型响应使用确定性替身；不调用真实付费模型。浏览器现有 Browserslist、Tailwind、Node 弃用提示不影响通过结果。依赖软链接不提交；未改父规格或用户 Hugo 内容，无 PR。完成前已合并最新 `codex-unit-ai-design`（已是最新）。
