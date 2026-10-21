# 指令与剪辑画布迁移：独立审查记录

固定基线：`bd3ee980284502382f29e5db8cd7b2c0836e3b78`。实现最终代码：`590378b21060727285806a9fbe80433b581f4a58`。两轴由独立审查者执行，发现统一在一个实现分支修复；父规格保持不变。

## Standards

### 初审

硬规则违反：

- [P2] `front/src/pages/aiStudio/directing/SceneTakeReviews.tsx:75`：新增 `<summary tabIndex={-1}>` 将所有历史审片记录的原生折叠入口移出 Tab 顺序；图只提供最新与仍适用记录，其余历史无法由键盘进入。依据 `site/content/docs/guide/workbench-design.md`「开发顺序」要求保留焦点与交互、「可重复验证」要求键盘路径可用。删除该 `tabIndex`，原生 summary 仍支持程序聚焦。
- [P2] `front/src/pages/aiStudio/directing/SceneInstructionCanvas.tsx:99` 与 `front/src/pages/aiStudio/directing/EditGraphCanvas.tsx:42`：指令节点没有有限 `size`，直接展开全部记录及原因；因此继承 `canvasWorkbench.css:96` 的卡内 `overflow:auto`。剪辑验收卡使用 `height: 360 + issues.length * 100` 并在第48行展开全部问题全文，卡片尺寸随数据无限增长。依据 `workbench-design.md`「文本、图标与内容层级」明确要求“有限尺寸与最多两行字段摘要，不在卡内滚动全文”；`guide/canvas-graph.md` 也要求两行摘要。将两类卡片限制为有限摘要，完整记录／问题沿现有工作区入口阅读。
- [P3] `SceneInstructionCanvas.tsx:112–114` 新图卡动作继续直接使用 AntD `<Button>`，而同一新增图中另一些动作使用 `WorkbenchButton`。依据 `workbench-design.md`「共享组件入口」及 AGENTS.md「代码规范」：新增／修改工作台动作先复用共享按钮，例外需记录原因和范围；本次 acceptance 未记录例外。新图卡动作统一采用 `WorkbenchButton`。

判断性建议（非硬违规）：

- Possible Duplicated Code：`SceneTakeReviews.tsx:8` 新增比较逻辑 `key !== 'participant_ids'` 与 `CanvasSequenceWorkbench.tsx:50` 的 `contentKey` 重复同一默认值归一化语义，且注释明确“沿用工作台保存比较”。可复用一个比较函数，避免今后保存与审片适用性分别修改。

只读审查；未运行长测试或重复工具诊断。已核对提交标题、规则索引及适用来源；额外大小写不敏感规范文件搜索仅发现既有 contributing.md。

### 最终复核

结论：无未解决的 Standards 发现；最终补丁未引入新的硬规则违反或需要报告的 baseline smell。

本次范围：只读检查 45f69484943f0c79f5ed8b2964d068d0cf695eb4..590378b21060727285806a9fbe80433b581f4a58。原三项硬规则与 Possible Duplicated Code 已通过的结论继续有效。

- 完整素材审片历史由明确入口或固定记录定位启用；普通选择和 graph/revision 更新不加载全历史，原工作区与草稿边界保持一致。
- 新历史与重试动作复用 WorkbenchButton；原生 summary 的 Tab／Enter 路径未退回，增强浏览器用例保留该检查。
- 复核成功合入 POST 返回的固定记录，按 ID 去重；迟到 GET 保留已取得的新记录，未引入自动确认、采用或新的保存链。
- 明确记录定位使用独立 serial，普通 Take／coverage／clip 定位清理旧阅读目标；与已有精确身份导航要求一致。
- architecture 与 guide 同步说明素材审片历史的读取边界，测试覆盖0自动GET、明确读取、跨画布恢复、刷新及确认后不重取全历史，符合 AGENTS.md 的文档同步及行为回归要求。

独立执行范围为代码、文档和测试阅读；已阅读 acceptance.md 最终 typecheck／lint／unit 与增强及原素材浏览器证据，未重复运行。后端未变，原复核结果复用。

## Spec

### 初审

(a) Missing/partial requirements

- **[P2] 剪辑默认总览仍自动获取完整历史。** Spec §3：“完整历史通过原记录阅读入口按需获取”；§5：“历史按需进入原记录”。`front/src/pages/aiStudio/directing/SceneEditCanvas.tsx:173` 仅用 `hidden={!workspace}` 隐藏工作区，仍在 241–246 行挂载全部落幅／接缝／整场历史组件。`SceneCutReviews.tsx:57–64`、`SceneSeamReviews.tsx:110–117`、`SceneEndFrames.tsx:39–46` 在 mount 时直接请求完整记录，且把 `evidence` 放入依赖，导致每次刷新 graph 又请求一次。复现：首次进入剪辑总览，不打开工作区、不点任何历史入口，即请求三个历史列表；点击“刷新图证据”再次请求。返回含固定 content 的完整历史，而非 graph 摘要。应将完整记录读取绑定明确的记录／历史阅读动作，并保持已打开表单的现有输入。

- **[P2] 版本投影仍会无界展开历史正文。** Spec §3：“版本列表读取也不能因此无界展开全部历史正文”。`backend/app/services/directing/edit_canvas.py:208–216` 对全部整场审查 ORM 记录流式读取，并逐条将完整 `row.content` 转为 `SceneVersionContent`，直到找到匹配；`scene_take_evidence.py:27–48` 同样按32条一批不断加载完整历史。`store.py:236` 的版本列表对每个版本调用完整投影。复现条件：某版本有 N 条审查记录，当前方案与全部历史依据不同；仅 GET 版本／版本列表就读取、校验全部 N 份历史设计／正文。`yield_per=16`／32条分页仅限制单批内存，不限制展开总量，违反明确读取边界。应存储／查询轻量适用性依据或建立有限的摘要查询，不在普通版本读取中扫描完整历史正文。

(b) Scope creep：未发现可确认项。

(c) Implemented-looking but wrong behavior：除上述历史读取边界，未发现足够证据支持的独立业务行为错误。

只读代码审查；未修改仓库、未运行长测试集。已读取完整规格及验收记录，并核对票据和提交范围；未将勾选或既有测试通过当作需求满足的证明。

### 最终复核

已独立复核45f6948..590378b及前两次报告关联代码。**未发现剩余可确认的Spec问题，原两项P2已修复。**

- `SceneTakeReviews.tsx` 现在仅明确点击完整历史、原记录导航或重试时启用GET；读取effect依赖不再包含graph、revision或普通Take定位。`SceneEditCanvas.tsx` 不再传入graph证据；原记录使用独立recordId/serial，普通Take、clip及关系导航清除旧record焦点。因此隐藏工作区、返回默认图刷新以及恢复记忆Take均不会自行重读完整历史。
- 历史读取开关没有卸载表单，现有dirty输入、播放器及原请求状态不因graph刷新重建。明确POST复核成功将返回固定记录合并进本地集合，无需全历史重读；迟到历史响应合并保留已确认的新记录。失败仍保留pendingRevision并沿原请求核实入口处理。
- 前次确认的cut/seam/frame按需门控，以及take/cut SQL预选最新／最近匹配、旧数据显式回填迁移保持有效。本补丁未改变后端比较语义、复制白名单或已保存基线规则。

新增浏览器断言覆盖普通Take选择零历史GET、明确原记录才GET、返回图刷新及跨导演恢复无额外GET、dirty内容和旧历史键盘入口。vhCXbz、DTDK3x及前端检查作为提供的已有验证结果复用；后端509 passed/15 skipped未因本次纯前端补丁而重跑。

本次为只读代码复核，未修改仓库、未运行长suite。未发现可确认的scope creep或新的业务行为错误。

## 交付

七张票据全部完成。实际检查、分段浏览器证据与未执行边界见 [acceptance.md](./acceptance.md)，修复与迁移说明见 [review-fixes.md](./review-fixes.md)。部署更新前在 `backend` 执行 `uv run alembic upgrade head`；本次未修改现有运行数据库。

初审：Standards 3项硬规则与1项判断性建议（最高P2）；Spec 2项P2。最终：Standards 0项遗留；Spec 0项遗留，两轴均无剩余最高问题。
