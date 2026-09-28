---
title: "本场资产与单元参考输入优化计划"
description: "保留场次资产关联与单元输入边界，以最小改动统一选图、补齐主体分组和来源，并明确视频模型实际接收的内容。"
weight: 34
status: completed
---

> 2026-09-28。以 `9c886b1` 为评估基线。T1–T4 已完成实现与离线验收；检查范围及既有 Pylint 问题见第 6 节。改动已完成本地验证，未发布。承接[资产准备与试拍衔接计划](/docs/plans/sequence-workbench-asset-to-shoot/)及[三步试拍计划](/docs/plans/sequence-workbench-shoot-flow/)，不改写其历史验收记录。

## 1. 目标与范围

用户能清楚分辨：本场关联了哪些资产、本次给模型发送哪些图片、修改会影响哪个版本。

保留项目资产、设计关联、单元参考三个既有层级；沿用“拍摄准备 → 指令检查 → 试拍与候选”。只调整参考数据与局部交互，不重建资产库、任务系统或页面外壳。

技术沿用 React、Ant Design、OpenAPI generated client、FastAPI、Pydantic 和现有供应商适配。执行时按任务顺序推进；可使用 `superpowers:executing-plans`，无需并行代理或另建实施方案。

### 职责边界

| 位置 | 负责内容 | 不承担的职责 |
| --- | --- | --- |
| 项目资产 | 稳定设定与资产图片管理 | 决定某次生成的输入 |
| 导演设计／本场资产 | 将本场人物、场所、道具关联到项目资产；查看和准备图片 | 设置模型、首尾帧或参考顺序 |
| 单元试拍／本次模型输入 | 为当前单元选择具体文件、主体、用途及模型输入位置 | 修改本场关联、复制维护资产档案 |

### 本轮不做

- 不新增场次默认参考包、自动选图、自动全量传图、批量套用或跨单元复制配置。
- 不新增资产版本管理系统、独立参考数据库表或通用参考编辑框架。
- 不自动合成首帧，不把人物档案图自动降级成首帧，不静默删除不兼容图片。
- 不扩展供应商能力，不新增音频参考执行能力，不重做连续性、剪辑或候选采用流程。
- 不自动把完整资产档案注入视频提示词；资产文字的显式采用与提示词内容清理不纳入本轮。
- 不按概念预览重做整页导演设计。预览只用于理解两层职责，不作为像素级验收要求。

## 2. 实施前已确认的事实

- `SceneAssets.tsx` 修改设计中的资产关联；`PlanEditor.tsx` 显式选图后写入 `unit.references`，关联本身不会自动传图。
- `ReferenceBinding` 已保存文件、用途、参与者、顺序、来源与输入位置；不需要替换整份契约。
- `ProductionService.validate_unit` 当前按每个绑定分别构造主体参考，同一人物的两张图片不会自动组成一个主体。
- `ShootFixedInput.tsx` 已展示固定计划中的图片与版本来源，可直接增强，不另建检查页面。
- 模型校验和媒体执行链已存在；前端目前展示通用输入选项，需将后端支持范围用于选图引导。

## 3. 最小数据方案与不变量

数据链保持：项目资产 → 已确认设计关联 → 单元具体参考 → 已确认计划／指令 → 任务输入快照 → 供应商请求。

在现有 `ReferenceBinding` 上做增量扩展，不把图片数组迁移成另一套模型：

- 增加可选 `subject_group_id`：仅主体参考使用，同一组的多张图映射为一个供应商主体；组内按已有 `ordinal` 排序。
- 增加可选 `asset_origin`：仅从本场资产选图时填写，保存资产类型、资产 ID 和选择时的名称。保留既有 `source` 表达人工作业来源，不复用它冒充资产身份。
- 不在此处复制资产描述、整个档案或图片内容。设计版本来自所属计划，文件由既有 `file_id` 固定。
- 同组必须具有一致的参与者集合、用途及资产来源；多主体合照可以绑定多个参与者，不按人数自动拆图。首尾帧不能携带主体分组。
- 新选入的同一主体图片使用明确组标识；没有分组信息的历史参考维持原来“一绑定一主体”的语义，不能按最新资产信息推断并重写。
- 编译文本的参考名称必须与实际发送的主体组名称对应；帧参考仍按位置表达。历史已确认指令和任务快照不重编译、不改写。
- 保存时校验新增来源属于当前项目、与固定设计关联及所选资产图片相符；同一设计下继承父版本或原草稿的未变来源保留历史名称，不重复要求匹配资产最新状态。确认后来源仅用于追溯，执行仍以固定文件及既有可用性校验为准，不重新挑选资产最新图片。
- 不要求历史数据回填；名称缺失时展示已有参与者或“历史参考”，不得臆造资产来源。

参考移除只影响当前计划；资产解除关联只影响当前设计草稿。修改确认后的参考必须形成新计划及相应指令，并重新检查。资产改名、换默认图不改变历史输入。

## 4. 任务清单

### T1：补齐主体分组与资产来源

涉及文件：

- `backend/app/core/contracts/directing/production.py`：参考字段与局部约束。
- `backend/app/services/directing/store.py`：项目、设计、文件与资产来源校验。
- `backend/app/services/directing/production.py`：主体聚合、提示词引用和提交共用同一转换结果。
- `backend/tests/directing/test_contracts.py`、`test_store.py`、`test_production.py`：回归覆盖。
- `backend/tests/services/test_media_execution.py`：在现有执行链测试中验证多图组传递；执行实现已有能力满足时不修改它。

- [x] 先补回归用例：同组两张图发送为一个主体，不同组保持独立；图片与组顺序稳定。
- [x] 增量扩展字段及校验；拒绝非主体分组、组内语义冲突、伪造资产来源、跨项目图片和未知参与者。
- [x] 聚合主体参考，同时让新编译提示词引用对应组；保留原有文件绑定身份，避免影响连续性证据。
- [x] 验证旧计划无新字段仍可读取，旧指令引用及重新提交语义不变；验证修改资产名称或默认图不会替换固定输入。
- [x] 验证最终供应商输入收到准确的图片数量、主体分组与帧位置；使用替身，不调用付费模型。

完成标准：新增分组表达正确，历史语义不变；单次与批量试拍继续复用同一准备逻辑。

### T2：把现有模型限制提供给前端

涉及文件：

- `backend/app/core/integrations/video_capabilities.py` 及实际受影响的供应商能力文件：复用现有能力来源。
- `backend/app/core/contracts/video_generation.py`：放置所需的能力输出 DTO，不放到 tasks。
- `backend/app/services/directing/production.py`、`backend/app/api/v1/routes/studio/directing.py`：服务负责能力整理，路由负责收参、鉴权与响应。
- `backend/tests/core/integrations/test_video_capabilities.py`、`backend/tests/directing/test_api.py`：能力与接口验证。

- [x] 增加一个按视频模型 ID 查询参考输入能力的只读接口；仅返回页面需要的输入位置、数量限制、是否可组合及已知／未知状态。
- [x] 输出依据现有供应商规则，不在前端复制模型名称判断，不另建能力注册中心。未知上限不能显示成无限支持。
- [x] 覆盖主体参考、首帧、首尾帧、组合不支持以及能力未知；保持最终提交校验为权威判断。
- [x] T1、T2 的对外契约完成后，从加载当前工作区的后端生成 OpenAPI 和前端 client。

完成标准：页面能解释哪些选择可用；查询失败允许保留和编辑草稿，但不宣称兼容；提交不会绕过现有校验。

### T3：统一选图入口并简化局部交互

涉及文件：

- `front/src/pages/aiStudio/directing/SceneAssets.tsx`：保留轻量关联面板，区分“更换关联资产”与“替换参考图片”。
- `front/src/pages/aiStudio/directing/PlanEditor.tsx`：本次输入、选图、分组与能力提示。
- `front/src/pages/aiStudio/directing/ReferencePicker.tsx`：仅抽取本次合并后的选图抽屉，不建设通用素材管理框架。
- `front/tests/workspaceShootSteps.browser.mjs`、`workspaceAssets.browser.mjs`、`workspaceAssetFlow.browser.mjs`：复用现有隔离浏览器用例。

- [x] 本场资产只展示关联对象、资产封面、可用图片数及既有详情／图片准备入口；不新增生成输入配置。
- [x] 将试拍选图入口合并为“添加参考”，抽屉内切换“本场资产／已有素材／上传”；默认列出计划所依据设计的资产。
- [x] 从资产选图时自动填入来源与已有参与者关联。同一主体允许多图选入；只在无法确定时要求用户指定主体或用途。
- [x] 根据 T2 显示主体分组或帧位置；首期不必新增独立“生成模式”字段，由已有输入位置表达。
- [x] 更换模型时保留图片，标出不兼容项并提供移除、替换或重新选择模型的操作；不自动转换语义。
- [x] 保留已有连续性入口与依赖检查。上传临时参考不创建资产；移除参考不解除本场关联。
- [x] 覆盖重复点击、取消抽屉、切换计划、加载失败和保存失败；继续使用现有草稿保护，不能把选择写入另一单元。

完成标准：用户无需重新关联资产即可按图选择；每个操作只有一个写入目标。已有全局导航、三步试拍及设计确认流程保持原样。

### T4：明确发送摘要并完成验证

涉及文件：

- `front/src/pages/aiStudio/directing/ShootFixedInput.tsx`：增强既有固定输入摘要。
- `front/src/pages/aiStudio/directing/PlanEditor.tsx`：准备阶段使用相同口径。
- `site/content/docs/architecture/directing-foundation.md`、`site/content/docs/guide/sequence-asset-to-shoot.md`：实施后更新真实行为。
- 本计划：记录各项完成状态、检查结果与未完成项。

- [x] 准备时显示“拟发送：提示词 + N 张图片”；开拍前从固定计划显示“将发送”，按主体组／帧位置列出图片和来源。
- [x] 摘要分别计算图片数与主体组数。零图片明确显示“本次不发送图片”，不等同于检查通过。
- [x] 摘要中不混入未选资产；编辑草稿与历史固定输入分别读取各自依据，不互相覆盖。
- [x] 执行下列适用检查，记录结果；通过后同步架构与指南，不提前将方案写成现状。

完成标准：可从页面摘要核对到最终请求中的具体媒体；历史名称和文件来源可追溯；新生成候选仍不会自动采用。

## 5. 验证方式

任务顺序为 T1 → T2 → T3 → T4。优先复用已有用例，仅补本次行为差异。相同代码与环境已通过的检查不重复执行。

在 `backend` 目录执行受影响测试：

```bash
uv run pytest tests/directing/test_contracts.py tests/directing/test_store.py tests/directing/test_production.py tests/directing/test_api.py tests/directing/test_continuity.py tests/directing/test_batch.py tests/services/test_media_execution.py tests/core/integrations/test_video_capabilities.py
uv run pylint app
```

若调整共享供应商能力解析，补跑受影响供应商测试；若改变共享生成基础设施或无法确定影响范围，扩展全量后端测试。无关基础设施不为本计划重构。

确认 `127.0.0.1:8000` 加载当前工作区契约后，在项目根目录执行：

```bash
pnpm --dir front run openapi:update
pnpm --dir front run typecheck
node front/tests/workspaceShootSteps.browser.mjs
node front/tests/workspaceAssets.browser.mjs
node front/tests/workspaceAssetFlow.browser.mjs
node front/tests/workspaceShootProgress.browser.mjs
node --test front/tests/referenceInput.test.mjs
```

浏览器验收覆盖桌面及 375px：资产关联、逐图选择、同主体多图、输入位置限制、模型切换保留选择、保存确认失败恢复、固定摘要与历史版本。预期无未处理页面错误、不横向溢出，按钮操作不会触发非预期生成。

离线请求验证不证明模型实际遵循参考图；如需真实模型验收，单独记录模型、固定输入和产出，不以图像相似度作为本轮数据链通过标准。

## 6. 执行记录

| 阶段 | 状态 | 验证结果 |
| --- | --- | --- |
| T1 参考数据与传递 | 已完成 | 分组、来源校验、历史继承／重组、任务快照重建及 Vidu 请求体对照通过 |
| T2 模型能力输出 | 已完成 | 能力接口、类别／项目检查及帧预检通过；OpenAPI 与 generated client 已同步 |
| T3 选图交互 | 已完成 | 统一抽屉、主体多图、读取失败恢复、模型切换、上传迟到和计划隔离通过 |
| T4 摘要与验收 | 已完成 | 草稿／固定摘要与历史来源通过；四尺寸浏览器、类型检查及文档同步完成 |

### 实施收敛与审查修复

- 沿用既有供应商能力声明与适配器，无共享能力注册改造、数据库迁移、默认参考包或批量能力。
- 供应商位置语义提前校验：OpenAI 只开放一张起始画面，避免将尾帧／关键帧静默变成普通输入图；可灵未知模型不宣称支持；Vidu 主体与帧不混用。旧不兼容配置保留可查看，重新拍摄需明确调整并重新确认。
- 独立审查指出的“资产改名阻断派生”和“OpenAI 尾帧承诺不实”均补回归并修复，复核无剩余发现。
- 使用单一 `ReferencePicker` 与小型分组／摘要函数；未拆分其他正常工作模块。

### 2026-09-28 验证结果

| 检查 | 结果与范围 |
| --- | --- |
| 第 5 节后端测试集合 | 68 项通过；后续仅增加历史继承、重组、任务快照往返及来源异常断言，受影响 store／production 23 项通过，最终来源异常用例单独通过 |
| `pnpm --dir front run openapi:update` | 已先确认 8000 端口进程的工作目录为本工作区 backend，在线 schema 包含能力接口和新参考字段，再生成；清理生成器带来的无关末尾空行差异 |
| `pnpm --dir front run typecheck` | 通过 |
| `node --test front/tests/referenceInput.test.mjs` | 3 项通过，覆盖默认主体角色、历史单图、分组／帧限额、模型冲突和摘要 |
| `workspaceShootSteps.browser.mjs` | 通过：能力重试、逐图选入／重复保护、同主体多图、模型切换不丢图、素材读取恢复、临时素材移除、上传迟到、保存／确认恢复、计划隔离及四尺寸布局 |
| `workspaceAssets.browser.mjs` | 通过：关联计数、无效引用、加载重试、未保存设计保留和手机入口，无业务写入 |
| `workspaceAssetFlow.browser.mjs` | 通过：新建关联、同身份重试、详情往返和已确认版本派生 |
| `workspaceShootProgress.browser.mjs` | 通过：固定图片数与历史来源名称、审稿推进、任务恢复、候选保留和四尺寸布局 |
| `git diff --check` | 通过 |
| `uv run pylint app` | 已执行，退出码 30；五项诊断均位于本轮未修改文件，本次应用代码未新增诊断 |

浏览器沿用 `front/tests/README.md` 的 Node.js／Playwright 环境。本轮使用本机 bundled Node.js 24 与 Playwright，全部业务请求使用隔离替身。最终试拍准备截图及记录输出在 `/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-shoot-steps-KAAxER`；固定输入验收输出在同级 `jellyfish-shoot-progress-weFnJR`。截图包含 1440／1024／768／375 宽度；参考抽屉和输入摘要另有手机截图，已检查实际布局。临时路径用于本次验收定位，不是运行依赖。

Pylint 既有诊断：`app/task_worker.py:263` W0706、`:355` R0911；`app/models/studio_assets.py:31` E0213；`app/api/v1/routes/studio/lab_generation_tasks.py:32` W0611；`app/services/task_queries.py:133` C0123。上述文件相对本轮基线无改动，按精准修改规则不在本任务中清理。

未调用真实视频模型，不将离线请求体通过解释为模型会准确遵循人物外观或动作。无本轮功能未完成项；全仓 Pylint 仍受上述既有问题影响。
