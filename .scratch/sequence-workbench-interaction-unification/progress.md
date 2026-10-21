# 落地进度

2026-10-20 实现与验收完成。基准提交 `6479ff07642d879c14613dc34f651631aa91a8b2`，当前分支 `codex/0718`。01–10 票据验收已勾选；`Status` 保留原有分诊值。

## 已落地

- 共享唯一详情目标、常规／展开尺寸、桌面非模态与窄屏焦点约束；同一编辑内容保持挂载，保存继续由业务层负责。
- 导演卡片、资产、附加信息、关系、单元设置／参数／依赖、来源和业务固定记录接入详情；卡片支持鼠标、键盘及 390px 真实触摸输入，内部原生折叠和表单控件独立交互。
- AI、批量拍摄与导出的操作和记录分离；参考选择、原文依据更新、时间线整理保留确认流程，辅助材料在当前操作内只读阅读并返回。
- 主指令编辑器、素材库、主播放器、审查及时间线继续留在业务工作区。更新工作台设计指南，移除本次迁移失效的旧容器样式。
- 修复验收发现的窄屏动作区横纵溢出、原生折叠误触卡片、桌面工具栏菜单层级、详情焦点回退与缺项定位滚动。

## 验证

运行环境：Node 22.21.1、Python 3.12.7、本机 Chrome（`PLAYWRIGHT_CHANNEL=chrome`）、隔离 SQLite 测试服务。浏览器服务监听需要沙箱外执行；环境预检通过。

- `pnpm --dir front run typecheck`：通过。
- `node --test front/tests/*.test.mjs`：182 通过，0 失败。日志 `/tmp/jellyfish-interaction-unit-final.log`。
- 工作台 UI 套件的 preflight、workbenchUi、sceneWorkbenchStyle、designScopeCompleteness 分项通过；已有通过结果按变更相关性复用。
- 下列 23 组浏览器回归通过。用例同步真实菜单、详情／内联阅读入口，并补齐已有准备度校验所需的测试夹具；保留业务请求身份、固定依据、保存与状态断言。
- 全部使用隔离任务及媒体夹具，不调用真实付费模型。导出回归实际执行媒体生成、下载和 ffprobe 核验。

### 浏览器证据

- `designCards`：PASS modal editing, shared reference, scoped assets, empty first shot and narrow cards; evidence: /var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-design-cards-Fxb2dX
- `sceneCanvasNavigation`：PASS per-shot unit memory, unique selection and unsaved cross-canvas navigation; evidence: /var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-xWxPlb
- `sceneCutReviews`：PASS fixed scene acceptance, framing invalidation and unknown-response recovery; evidence: /var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-vQS4yw
- `sceneDesignReferences`：PASS design reference recovery; evidence: /var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-0IWisR
- `sceneExport`：PASS real export download, frozen input, unknown replay and original retry; evidence: /var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-03G1eE
- `sceneFrameDependencies`：PASS explicit frame binding and affected-unit-only execution gate; evidence: /var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-azLQMD
- `sceneInstructionBasis`：PASS instruction basis workflow; evidence: /var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-unJoP0
- `sceneInstructionPreparation`：PASS instruction preparation locates missing duration before generation; evidence: /var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-jXFq42
- `sceneInstructionPrimary`：PASS completed unapplied instruction suggestion remains the next action after reload; evidence: /var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-K7rXdh
- `sceneInstructionSuggestions`：PASS instruction suggestion workflow; evidence: /var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-Jt9hxJ
- `sceneOverview`：PASS whole-scene overview identities, targeted navigation and isolated read recovery; evidence: /var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-2nmfzx
- `sceneSeamReviews`：PASS local seam review, actual boundaries, preview exclusivity and request recovery; evidence: /var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-68tYHY
- `sceneSharedNavigation`：PASS shared objects and references inspected in place without changing current work; evidence: /var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-X2BU2i
- `sceneTaskHistory`：PASS instruction task history opens original fixed record without switching or saving current work; evidence: /var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-ItthKl
- `sceneUnitCoverage`：PASS unit coverage browser workflow; evidence: /var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-2eqPVV
- `sceneVersionWorkbench`：PASS scene version browser workflow; evidence: /var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-yhQCTL
- `sceneVideo`：PASS scene video workflow; evidence: /var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-R9VQHG
- `sceneVideoBatch`：PASS batch preflight partial submission; evidence: /var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-s0iBvg
- `sceneVideoBatchIndependence`：PASS independent A/B/C preflight and submission; evidence: /var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-PxspTj
- `sceneVideoBlocked`：PASS scene video blocked after save; evidence: /var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-QpmPNq
- `sceneWorkbenchStyle`：PASS four-canvas style, desktop/narrow controls, shared floating panels, unchanged viewport, saved/unsaved input, real media, timeline and export menus; evidence: /var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-workbench-style-0RRaR7
- `workbenchUi`：PASS workbench component states, accessible actions, long text and responsive modal; evidence: /var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-workbench-ui-6kdAym
- `designScopeCompleteness`：PASS design-to-unit guidance, shot navigation without writes, incomplete candidate preview, explicit apply, persisted issues and issue location; evidence: /var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-design-scope-z8WEMa

## 审查与范围

Standards／Spec 两轴审查完成；发现项均已修复并复核，无遗留确定问题。前端展示与交互迁移未改变后端接口，因此无需 OpenAPI 重新生成或后端应用检查。

`site/hugo.yaml` 是实施前已有的用户修改，不纳入本次提交。没有未完成实施项。

## 2026-10-21 审查修复：菜单 Escape 优先级

修复桌面详情打开时，画布 portal 菜单的 Escape 穿透关闭详情的问题。可见菜单先处理 Escape，下一次 Escape 才关闭详情。

- 先添加真实工作台回归，确认原实现因第一次 Escape 关闭详情而失败；修复后通过。
- 回归覆盖菜单关闭、入口焦点恢复、详情保留、第二次 Escape 关闭详情，以及未保存输入和画布视口保持。
- 验证通过：前端 typecheck、182 项纯行为测试、preflight，以及 workbenchUi、designScopeCompleteness、sceneWorkbenchStyle 三项浏览器回归。
- Standards／Spec 两轴复核均为 0 项发现。无接口或后端变更。
- 浏览器证据：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-workbench-style-I7VypQ`。
