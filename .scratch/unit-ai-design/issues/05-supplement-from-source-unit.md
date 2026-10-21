# 05: 从原单元新增补拍并继续拍摄准备

Status: ready-for-agent
Blocked by: 03
Resolution: completed

**What to build:** 用户明确选择原单元，通过统一“AI设计”生成“保留原单元＋新增局部补拍单元”，继承可用输入，确认后继续编译、审查和拍摄。

来源规格：[单元画布 AI 设计与生产单元组织](../spec.md)。

## 前端要求

- 按明确来源单元身份发起补拍，优先可见地预选其有效视频模型；无有效值时要求用户选择，不增加独立补拍 AI 按钮。
- 预览同时展示原单元保留和新增补拍，显示继承的配置与真实参考、需要补齐的条件和能力冲突。
- 确认后新单元可局部手动修改，并进入既有指令编译、检查与拍摄流程；当前方案、指令依据、准备度、任务成功和素材采用分别表达。

## 后端要求

- 冻结来源单元、相关设计、参考和依赖输入，生成后相关变化使结果失效；来源归属明确，不猜测同镜头其他单元。
- 新补拍使用新单元身份，原单元及未涉及的覆盖项保持；不迁移旧任务、Take 或检查归属。
- 继承来源的内容、配置及真实参考输入，按本次明确要求局部调整；仍有效的输入保留，模型能力冲突明确报告，不静默清空或伪造可用性。
- 新单元使用用户本次目标视频模型，原样保留的单元继续原模型；不把旧检查通过、指令依据确认或实际覆盖结论复制成新单元已完成状态。
- 规划进入/结束状态及参考需求不替代真实落幅，依赖仍绑定历史来源；不触发自动采用或自动剪辑。
- 既有编译、审查、模型预检及视频任务链路继续执行本次局部范围，生成成功只登记候选 Take。

## 验收标准

- [x] 浏览器在多单元镜头中选择正确来源，预览原单元保留和新补拍，确认保存后两者身份不同且原单元未改写。
- [x] 真实 HTTP 验证继承的参考、参数和依赖保持归属；无效能力组合给出可定位缺项，不能通过空字段或伪造检查绕过。
- [x] 来源或参考在生成期间改变使结果失效；目标镜头完整方案中的单元变化按覆盖依据重新校验，其他独立镜头的无关变化不单独导致失效。
- [x] 覆盖“原镜头拆信、读信、抬头，只补拍抬头”，编译与检查不扩大范围。
- [x] 在具备必要真实准备的测试夹具中完成指令检查、提交拍摄与登记 Take；仅替换外部模型响应，确认没有自动实际覆盖或采用。
- [x] 旧任务和检查记录保留原身份；运行中的旧任务继续使用固定输入，不被新增补拍改绑。

## 验证与完成要求

- 使用已确认的真实 HTTP、数据库与任务生命周期测试，以及现有浏览器流程；仅替换外部模型响应。
- 遵循 TDD：逐条验证行为，先看到相关用例失败，再实现并确认通过。复用既有单元范围投影测试入口。
- 前端改动执行项目 typecheck；Python 应用改动执行相关测试及全应用 Pylint；对外契约变化同步 OpenAPI 与 generated client。
- 验证范围与本票变化匹配；完成时记录实际命令、结果和限制，并勾选已通过的验收项。

## 范围与依赖说明

依赖 03 的应用机制和其已包含的 01 执行边界。不依赖 04 的原单元修改行为；本票保留原单元，独立新增补拍，不处理移除。

规格编号：FE-02、FE-03、FE-04、FE-08、FE-12、BE-01、BE-03、BE-05、BE-07、BE-08、BE-09、HP-02、HP-03、HP-06、HP-07、HP-09、HP-10、FA-03、FA-04、FA-09、FA-12、FA-13、BA-01、BA-08、BA-09、BA-10、BA-11、BA-12、BA-14、BA-19、BA-21。

## Comments

- 2026-10-21：用户调用 implement-spec，按已提出的六张任务及依赖进入实施。



### 票据 05 实施与验证

- 2026-10-21：明确 `source_unit_id` 冻结来源；统一 AI 设计保留项与新建项使用 `operation=retain/create`，保留项保持原模型、顺序和配置，新补拍使用本次目标模型与新身份，不增加独立 AI 按钮或模式选择。与票 04 共用 nullable 组织建议合并及完整预览／应用组合。
- 新单元继承真实正文来源、参数、参考与历史依赖，重置 `instruction_basis_id` 和 `instruction_check_task_id`。预览显示固定来源、继承参数／真实参考／历史依赖／正文及缺项。来源已有 5 秒预计时长保留；模型上限未知显式显示待核实。参考位置／参数冲突保持原值并明确列出；缺实际落幅的历史依赖不会被 AI 状态替代。
- 仅原出现项适用的设计选择对新身份整体拒绝，既有导演适用范围与原单元不修改。来源、参考或同镜其他单元变化拒绝旧结果；原单元不在列表末位也能完成新增和首次保存。
- 真实 HTTP 闭环验证“拆信、读信、抬头”仅补拍抬头：编译与六岗检查只消费抬头执行范围，完整镜头仍作为背景；检查确认后真实提交视频任务并登记未审查候选 Take，无实际覆盖和自动采用。旧来源的运行中指令任务仍按原身份与固定范围完成，历史未迁移。
- TDD：先确认 HTTP 不接受来源字段（422），实现公共来源契约后补拍应用与保存 green；历史依赖预览缺少“待绑定实际落幅与参考”先 red，再追加缺项 green。浏览器先确认所选来源模型未预选，再接入公共 UI green；预览缺明确继承来源先 red，再补只读继承输入展示 green。
- 通过：backend 目录 `UV_CACHE_DIR=/tmp/jellyfish-uv-cache uv run pytest tests/directing/test_scene_unit_design.py tests/directing/test_scene_unit_supplement.py tests/directing/test_scene_instructions.py tests/directing/test_scene_video.py tests/directing/test_scene_units.py -q`，17 passed；随后补充运行中历史任务断言的 `test_scene_unit_supplement.py` 与 `test_scene_unit_design.py`，5 passed。
- 通过：backend 目录 `UV_CACHE_DIR=/tmp/jellyfish-uv-cache PYLINTHOME=/tmp/jellyfish-pylint-cache uv run pylint app`，10.00/10；项目根 `pnpm --dir front run typecheck`（最终同步集成后亦通过）。同步集成未改变 Python 应用文件，复用通过结果。
- 通过：`PLAYWRIGHT_CHANNEL=chrome node front/tests/sceneUnitSupplement.browser.mjs`，独占 8245/4245；真实多单元来源 B、来源模型预选、A/B 保留、新身份补拍、继承 B 的 seed／正文、保存回读刷新，以及当前切到 A 后查看旧任务仍显示 B。桌面／390px 截图已目视检查，窄屏布局稳定等待后无横向溢出且确认按钮在视口内。最终证据 `/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-dAH1IQ`。
- 公共 OpenAPI 与 generated client 随票 04 一并同步；本票无额外契约变更。主 8000 正式 `openapi:update` 和全套 workbench UI 验收按根集成安排执行，不停止用户服务。复用 WorkbenchModal、WorkbenchButton、CanvasTextPreview，无共享样式或组件例外。
- 完成前已合并最新 `codex-unit-ai-design`（f7ec86a），保留票 04 最终验收记录与浏览器窄屏断言。仅外部模型／存储边界使用确定性替身，不调用付费模型；现有 Browserslist、Tailwind、Node 提示不影响结果。未修改父规格／Hugo，未建 PR。

- 2026-10-21：本票已合入 `codex-unit-ai-design`；正式 OpenAPI 同步、最终集成回归和两轴审查修复记录统一见[集成验收](../validation.md)。此前委托主集成执行的检查以该记录为准。
