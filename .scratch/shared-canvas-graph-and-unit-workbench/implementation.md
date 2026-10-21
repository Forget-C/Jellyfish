# 实施记录

审查起始点：`d264de4738484306d5b1b17ad588803546d31ac6`，当前分支 `codex/0718`。本次工作按[规格](spec.md)和[8 张票据](README.md)推进，目标保持完整范围；尚未整体验收、审查或提交。

## 当前进展

- 01 已建立共享强类型 graph、构建器和结构校验、读取上下文及导演全场投影；原文与全场卡片消费服务端标题、摘要和成员。已将既有关系图业务构建从契约模块移到 service。接口与 generated client 已同步；运行中的 8000 端口已核实属于当前工作区，并具有新增契约。
- 06 已将输入停顿保存改为固定 5 秒周期检查，复用现有串行队列。普通失败重试保持原请求，校验错误等待修改，冲突等待明确处理；错误保留到成功，迟到响应不覆盖新输入。
- 02 导演镜头子图、共享引用、聚合预览已消费后端图。抽离 GraphCanvas、GraphSubgraphPreview、graphLayout/useGraphLayout、useGraphBrowse；导演专属尺寸、分组兼容及旧缓存迁移留在适配器。尚待最终导航／布局清单核对，未标记票据完成。
- 03 新增独立 UnitCanvasGraph、强类型镜头依据／单元／配置／参考节点和 unit_graph 投影器，使用同一 GraphAssembler 与 CanvasReadContext；版本读取与保存同时返回两图。单元前端已移除固定三节点拼装，按后端成员显示全部／指定镜头与完整单元子图，复用共同容器／预览／历史／位置缓存。已有设置、参考、参数、依赖详情及当前编辑选择入口保留。精确外部入口、历史与数据证据等验收尚待补全。
- 07 修复恢复编辑时旧本地基线覆盖最新服务端图：核实可恢复后把缓存内容的 base 换成刚读取的 server，未保存输入保持原样。浏览器已复现旧行为并验证修复；其余恢复组合待最终核对。
- 04 已接入动作覆盖按准确 coverage ID 的独立详情、生成配置及参数详情、组织要求详情。人工未填写的组织要求可明确记录 human 来源后建立；已有 AI 来源保留原任务追溯，首次 AI 来源仍验证真实成功任务，且完整来源签名变化会重新核对，不能用同名引用绕过。理由／来源只在详情，待准备要求不变成真实参考。全部镜头新增使用目标选择弹窗，单镜头新增直接使用该镜头；AI 弹窗在全部镜头时也明确选镜头并保留单 coverage 限制。未保存新单元沿用当前编辑选择入口，未创建前端临时 graph。
- 03 继续补验：已支持 unitView 精确链接初次加载直达子图及失效目标提示；导演逐镜下一步显式写入 unitShot，常规切换清理 unitView，版本选择清理旧筛选。AI 记录回跳消费与镜头筛选合并一次路由更新，避免互相覆盖。其余任务／历史入口的首 coverage 依赖仍需审计。
- 05、08 尚待完成，07 尚待组合验收；当前不结项。指令与剪辑 graph 不在本轮迁移范围。

## 已获得的行为证据

- 新周期保存浏览器用例：修改前复现 1.2 秒时提前提交；修改后覆盖四画布切换、无变化不请求、失败原样重试、新输入保留、422 等待修正、手动／周期串行及真实并发冲突并通过。证据目录：`/private/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-periodic-save-NV8F0T`。
- 新 graph 浏览器用例：修改前后端标题不影响卡片；修改后验证标题、摘要、成员和原文来自服务端，编辑器保留当前内容，保存才更新图。证据目录：`/private/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-canvas-graph-J4eiLm`。
- 共享 graph 公共边界及版本接口测试：20 项通过（含跨镜头、同镜头多 coverage 的完整子图及单 coverage 执行限制），包含重复身份、悬空引用、视图层级、无效目标、跨 revision 和显式历史上下文。
- 版本接口与图测试合跑：39 项通过；后续补充的图校验用例单独再次通过。
- directing 全集首轮：478 项通过、15 项跳过，16 项因默认沙箱禁止本地 HTTP 夹具监听而在 setup 报错；对这 16 项授权重跑全部通过。尚未将此记录当作最终全仓测试结果。
- 后端全应用 Pylint：修正关系图函数搬迁遗漏的类型导入后通过，评分 10.00；使用临时缓存目录避免用户缓存目录写权限问题。
- 前端 TypeScript 检查通过；共享布局纯逻辑 7 项通过。导演布局／缓存／导航浏览器通过：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-director-layout-gJXxq5`。该浏览器的新建 API 夹具曾因历史无 ID 行被拒绝，已仅在本测试的新建数据补齐稳定 ID。
- 导演完整图与本地恢复浏览器通过：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-canvas-graph-mLBNW5`。单元完整子图首轮浏览器通过：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-canvas-graph-Mpi5h1`；扩充后端摘要／筛选／前进返回的检查通过：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-canvas-graph-QyqWtM`。
- 最新 graph + scene_versions 合跑 41 项通过；全应用 Pylint 10.00 且退出成功。最新单元 UI 后完整工作台及周期保存组合仍需回归。

## 后续验证要求

继续以 HTTP、共同图公开边界和真实浏览器旅程驱动实现。代码变化后只重跑相关范围；最终执行完整测试、两轴代码审查，逐项核对 A01–A20 后再结项。票据未因部分测试通过而标记完成。

## 本轮新增证据

- 上一轮和本轮均属于 progress，未提交、未标记票据完成，完整 goal 保持 active。
- 新增强类型只读 UnitBasisCanvasNode、逐消费行的 CanvasBasisTarget 和完整性验证；复用既有 unit_scope，范围类型移至独立 contracts/directing/unit_scope.py，指令与历史消费者同步导入。单元投影仅借导演投影的真实元数据定位来源，不用其连线决定执行范围。
- 依据 UI 复用 UnitScopeSummary，只有后端提供真实地址时才显示来源定位。覆盖项跳到准确详情，导演来源打开原卡并聚焦实际字段；历史阅读仍保留原范围且不新增编辑能力。ScopeRows 保留制作阶段、条件及未解决项。
- CanvasReadContext 批量读取视频模型名称，风格通过既有 applicable_style 回调解析；测试证明候选和不适用规则不进入实际约束，模型改名／删除可在场次 revision 不变时改变重新读取的风格证据与未知项。
- 新增 CanvasReferencePreview；共同上下文只读取当前项目 FileUsage 可见文件。参考绑定按 ordinal 展示，预览使用文件真实名称、媒体／缩略图地址和登记状态；删除／缺失／类型不符明确诊断，不伪装成字节或模型输入已验证。复用 ReferencePreview，旧入口继续使用原固定绑定，graph 入口可消费后端预览元信息。
- 修正配置对象路径：覆盖地址指向具体出现项，生成与依赖指向真实单元，组织字段声明与详情实际字段一致；API 检查直接走返回内容的路径，避免虚构 generation 属性。
- 最新相关后端测试 42 项通过（canvas_graph、unit_scope_projection、instruction_destinations）。包括部分动作不被完整镜头背景扩大、后期与视频阶段、两图公共校验、非法／缺失依据定位、绑定计数／预览匹配异常、跨单元同文件独立性、文件删除后同 revision 的失效投影。
- 全应用 Pylint 10.00 且退出成功；最新 TypeScript 检查通过，diff --check 通过。两次 OpenAPI 生成已同步新增类型并清除无关换行；无代码生成期间运行的浏览器证据计入结果。
- 最新主浏览器全旅程通过：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-canvas-graph-kkooQu`。包含既有配置／保存／恢复／导航旅程，加上只读依据、覆盖和导演字段定位、真实上传图片的后端名称／地址及实际图片字节解码验证。早一版仅验证地址的通过证据为 GrXplh，最新结果以 kkooQu 为准。

## 本轮新增证据（依赖与视图地址）

- 本轮属于 progress。固定计划和场次采用分别使用 CanvasPlanDependency／CanvasSceneDependency；UnitConfigCanvasNode 返回 dependency_evidence。上下文通过既有存储校验读取证据，单元投影生成摘要、具体问题与来源；卡片复用 SourceLinks，详情继续使用原依赖编辑器。
- DirectingStore._scene_version_snapshot 读取已鉴权场次的强类型内容而不构建图；read_scene_version、实际落幅校验和依赖检查共享该读取，避免从图证据回调递归读取其他版本图。scene_frame_source 统一提帧返回、绑定验证与 graph 的实际来源构造。
- 证据区分 unbound/current/needs_review/unavailable；保留固定版本、原单元／采用、frame_id、reference_id、实际帧文件、解码位置和原 Source。current 的结构不能缺失实际帧和来源，异常公开契约测试通过；这不是整体准备状态。
- sceneFrameDependencies 浏览器已更新为当前“单元镜头筛选”入口，保留所有原业务断言并新增 graph 证据断言。最新完整通过：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-JNSHBc`。真实提帧绑定为 current、原采用区间变化后 needs_review、旧帧／参考保留、明确换绑后恢复 current；只有受影响单元被真实执行门禁拦截，其余单元仍可准备。
- UnitGraphCanvas 不再按有效视图 ID 的 shot:/unit: 前缀判断业务类型；镜头筛选使用 ShotBasisCanvasNode.home_view_id，单元选择使用视图 anchor，入口使用 entry_view_id。后端补正确的镜头归属视图。合法改名为 service-shot-view／service-unit-view 的 graph 浏览器先红后绿，证明浏览器没有重建这些地址。
- 最新主 graph 完整浏览器通过：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-canvas-graph-kWq4tj`，包括不透明地址测试及原依据／参考／配置／保存失败／恢复／导航旅程。
- 仅描述 coverage 形态的字段改名为 execution_scope_supported，OpenAPI 和 generated client 已同步，明确不代表整体准备通过。生成后已清理无关换行差异。
- 最新相关后端合跑 44 项通过（graph、unit_scope、instruction_destinations、scene_dependencies、scene_end_frames）；全应用 Pylint 10.00 且退出成功；最终前端 typecheck 与 diff --check 通过。所有本轮测试句柄已结束，未提交、未标记票据完成，goal 保持 active。

## 下一轮接续（最新）

- 05 继续完成模型能力与实际输入问题的后端投影。已读 ProductionService.reference_capabilities 和 validate_prepared_unit；后者组装 MediaInput 元数据，不下载媒体字节；不应连带调用其业务门禁进行每次图读取。应把可共享的元数据校验提为真实执行与 graph 共用的深模块，保留最终实际输入复核，不复制一套准备引擎。reference_capabilities 可提为独立 service 函数供既有方法和 CanvasReadContext 复用，避免 DirectingStore 依赖其派生 ProductionService 或产生读取递归。
- 固定计划分支证据实现复用 validate_frame_binding／continuity_errors，当前完整浏览器主要覆盖 scene 分支；需要补 plan 分支的实际证据、历史来源不可用及独立单元隔离验证。
- 依据定位边界待补：组织要求来源应聚焦 entry_state／exit_state；当前本地覆盖／组织被移除后的旧来源要明确不可用。固定项目风格不在导演图时返回的不可定位原因可补具体版本／规则标识。
- 03 仍需审计 CanvasSequenceWorkbench 的 coverage[0] 任务／视频／剪辑回跳，精确单元选择不靠首镜头。UnitGraphCanvas 的有效视图地址已不猜前缀，但未知 focusUnitId 仍构造 unit:<id> 失败地址，应检查不透明 ID 下的失效目标边界，避免偶然匹配其他视图。还需核对离开单元画布后的 unitView URL 上下文及刷新／回跳行为。
- 其他既有浏览器仍有旧“单元所属镜头”控件及“增加补拍”按钮名，按已确认新交互更新实际入口，不缩减业务断言；designScopeCompleteness 的总览下一步应恢复全部／上次筛选，不默认首镜头。最新完整 AI 浏览器上一轮 c5yt8Z，本轮图证据扩展后尚未整体重跑。
- 之后完成 07 组合恢复和 08 A01–A20 逐项审计、完整测试、必要 UI／窄屏／键盘旅程、两轴 code-review、修复与当前分支提交。完整目标未缩减，禁止提前结项，禁止第二套保存或领域草稿。


## 本轮新增证据（模型输入共同规则）

- 抽取 services/directing/unit_video_inputs.py，真实 ProductionService.reference_capabilities／validate_prepared_unit 与 CanvasReadContext／单元投影共享模型解析和元数据校验。没有重复准备引擎，不下载媒体字节、不提交任务；原执行覆盖和连续性门禁保留。
- 共同上下文批量读取完整 Model，再解析当前供应商与适配器；生成配置返回 reference_capabilities 与 capability_error。参数／画幅／时长问题定位生成卡，参考组合／角色问题定位参考集合；未知配置明确未核实，多 coverage 不提升执行支持。
- 新 HTTP 用例先因缺少能力字段失败，接入后 graph 测试 23 项通过；现有 API 用例 8 项通过。覆盖 sora 首帧限制、不支持参数／主体参考、供应商改变但场次 revision 不变的重新读取，以及无视频任务提交。
- 8000 当前后端已核实包含新契约，OpenAPI 与 generated client 已同步并清除无关换行。全应用 Pylint 初轮发现两条因抽取产生的无效导入，已删除；最终 Pylint／TypeScript 检查结果见后续记录。
- 后续仍按上一节剩余项推进：固定计划证据、定位边界与精确入口审计、07/08 完整验收、最终测试和两轴审查、当前分支提交；完整 goal 保持 active。
- 最终本轮 TypeScript 检查通过、git diff --check 通过；全应用 Pylint 10.00，无告警。尚未把这些局部验证当作整体验收完成。

## 本轮新增证据（精确单元、来源与完整后端）

- 上一轮是 progress：新增了真实执行／graph 共用输入规则、HTTP 证据和接口同步；本轮继续实现与验证，没有重新定义目标。
- 指令画布原先从当前镜头的单元列表查找明确 unitId。新真实浏览器旅程以 only-B 单元、unitShot=A 进入依赖详情再前往指令页，先因正文不可见失败；改为按完整内容查找精确单元、在选项中保留当前明确单元后通过。
- CanvasSequenceWorkbench 的任务通知、任务原始入口、视频回跳和剪辑定位不再使用 coverage[0] 推导替代镜头。InstructionActivityTarget 移除虚构唯一镜头身份；原单元与原任务／执行记录仍须核实，不选择替代记录。
- 常用画布切换、单元进入指令／剪辑及依据进入导演时清除 unitView，避免旧子图 URL 在刷新时误导初始画布。未知 focusUnitId 不再拼接 unit:<id> 猜测视图，改为明确不可用；有效来源仍只使用后端 home_view_id。
- 组织依据字段定位先复现未聚焦。增加真实 DOM 地址后仍失败；诊断证明详情切换时字段尚隐藏，焦点返回原打开按钮。WorkbenchDetails 新增可选 focusTarget，在 visible 生命周期中聚焦本面板真实字段，移除单元页提前 rAF 聚焦。完整浏览器证明 exit_state 获得实际焦点；当前编辑中已移除的覆盖／组织来源显示不可用，不打开替代对象。
- 最新主 graph 全旅程通过：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-canvas-graph-sK5KoW`；包含不透明视图、完整跨镜头单元、精确指令入口、来源字段焦点、URL 清理、配置／真实图片／保存失败／当前编辑／恢复等既有断言。
- 新固定计划落幅 HTTP 用例通过。实际采用区间变化只使相关单元 needs_review，独立单元保持 current；帧文件失效后 unavailable，原 frame_id 保留。重新读取时场次 revision 和 content 均不变。相关 graph/API/连续性/实际范围测试合跑 57 项通过。
- 完整后端测试：`785 passed, 19 skipped in 144.41s`，退出成功。使用授权本机监听运行以覆盖真实 HTTP 夹具；不是将沙箱 setup 错误计为通过。
- 最新 TypeScript 与 diff --check 通过。后端应用自上一轮全应用 Pylint 10.00 后无新增改动，本轮后端仅新增 HTTP 测试。
- 四画布周期保存完整旅程通过：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-periodic-save-jvvlKF`。随后扩充两类 graph 响应失配／原样重放／继续输入的组合，尚待运行该扩充版本。
- 工作台 UI 组件验收已通过（`jellyfish-workbench-ui-0DfBRA`）。完整 UI 命令在真实页面样式用例的旧“单元设置”定位菜单失败；已改用后端“单元 1”聚合入口，保留原布局／窄屏／交互断言，重跑进行中。设计范围总览下一步改为验证全部镜头入口；完整版本浏览器旧新增入口改为明确筛选后创建，均待运行。
- 新增 guide/canvas-graph.md，说明后端契约／上下文／构建器／投影器、真实输入校验、前端组件／布局／导航、来源定位、统一保存、验证和 OpenAPI 同步步骤；工作台标准与指南目录已链接。当前架构更新精确视频回跳边界。

### 本轮后续重点

- 继续核对离开单元子图的全部业务回跳 URL 清理；目前常用入口已覆盖，关系树、同版本视频／指令通知及个别定位回调仍需逐项审计，避免多次 setParams 覆盖另一条导航。
- 导演附加信息仍有原始 content 的镜头数量及 graph.nodes.length 卡片数量显示，需收敛为后端视图／graph 元数据；不要用前端猜测数量作为图摘要。
- 两类 graph 响应失配的周期保存扩充用例、完整版本恢复浏览器、UI 样式与设计范围浏览器仍待本轮后续完成。再核对 A01–A20、未保存新增单元关闭恢复组合、真实主流程及历史／只读限制，完成两轴审查、修复和当前分支提交。

## 本轮验证补充（已结束句柄）

- 工作台真实页面样式完整通过：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-workbench-style-XLt2sv`。覆盖四画布、1440/1280/390、共享浮层、视口不变、输入保存、真实媒体、时间线与导出菜单。
- 设计范围完整性浏览器通过：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-design-scope-nMg8Ob`。初次总览进入全部镜头；明确镜头进入对应视图；再次从总览进入恢复上次 shot2 筛选，未创建或保存单元。新摘要使用真实节点内容而非旧独立文字节点定位，原业务断言保留。
- 扩充后的周期保存浏览器通过：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-periodic-save-kIfdBr`。director_graph 与 unit_graph 各自 revision 失配后不宣布成功；服务端已提交 A，用户输入 B，重放原请求仍不推进 revision，B 随后按新 revision 保存。
- 新发现 checkRecovery 在未知原请求重放被 422 明确拒绝后，available 分支仍使用旧缓存 base。真实浏览器先因恢复后缺失最新后端卡片标题失败（lNgkHX），修正 failed.base=server 后完整主浏览器通过：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-canvas-graph-6AdHSq`。当前输入保留，最新图未被旧本地基线替换。最新 typecheck 通过。
- 完整 sceneVersionWorkbench 浏览器已启动，句柄和结果待接续记录；此前新增入口已改为显式单镜头筛选和同一“建立单元”按钮，原断言未删减。
- 追加待验边界：单元 graph 缺失的初次加载应显式错误而非 SceneUnitCanvas 提前访问 graph.nodes 崩溃（导演已有包装保护）；需补 HTTP/浏览器异常读取证据并对称处理。参考编辑按钮在当前单元已移除时也应明确不可用。新增单元失败后关闭页面再恢复的完整组合仍需直接验证。
- 完整 sceneVersionWorkbench 浏览器最终通过：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-iyd28F`。参考步骤明确进入第二单元子图并按该单元集合点击，避免多单元同名按钮歧义；保留上传损坏／真实媒体、准备、保存、撤销、未知请求、恢复、冲突、存储失败、另一恢复记录、多页面交接、只读与 malformed relationship graph 等原完整断言。
- 前端全部纯逻辑测试：`node --test front/tests/*.test.mjs`，182 passed、0 failed、0 skipped；退出成功。最终 diff --check 通过。本轮所有测试句柄均已结束。
- 当前仍属 progress；无新提交、无票据提前结项，goal active。下一轮先处理已记录的初次缺失 unit_graph 保护及其浏览器 red/green，然后补新增单元失败后真实关闭／恢复组合；继续完整入口／计数元数据审计，最终 A01–A20、代码审查与提交。

## 本轮新增证据（异常加载、关闭恢复与闭环收尾）

- 上一轮是 progress：精确入口、真实字段焦点、外部 plan 落幅证据、全后端与前端逻辑／完整浏览器结果均已产生权威证据；本轮不重启或缩减目标。
- 缺失 unit_graph 的初次浏览器读取先失败（uayT03），SceneUnitCanvas 增加与导演对称的快照包装保护后通过，保留父工作台输入且不前端补图。
- 新增单元明确 422 后实际关闭页面，在同一浏览器上下文重开、恢复并从“当前单元”打开原输入；服务端仍只有两个原单元，没有强制保存／假 graph。网络未知后原样重放成功本应进入已保存状态，不误判为恢复缺失。
- 恢复后明确保存新单元，再撤销两步从当前内容移除，旧 graph 的参考入口提示来源移除、不打开其他单元；重做恢复原输入。参考入口和配置／依据定位都核对当前对象。
- 导演新增后端 shot_count；附加信息读取该字段与后端 view.node_count，不另算业务数量。HTTP 零／两镜头用例先红后绿；全部 graph 用例 23 passed。已核实 8000 当前 schema 并生成 OpenAPI／client，清理无关生成换行；typecheck 与全 app Pylint 10.00 通过。
- 全部 directing 在计数改动后 500 passed、15 skipped；其后补充 legacy HTTP 用例单独通过。旧无 ID 同内容行不在读取时补 ID、同 revision 地址稳定，保存后临时 ID 集合不复用；测试不绑定临时 ID 的字符串命名实现。
- 入口审计补齐关系树、剪辑定位、同版本视频／指令通知及准备缺项离开 unitView 的清理；切版本使用既有 select，避免第二次参数写入覆盖版本导航。入口错误文案只描述实际核对的单元。
- 新发现 AI 来源 lookup 用 coverage.every 将跨镜头当前单元排除，错误进入“未选来源”状态。浏览器先红（1tlifK），改为按精确 unitId 保留来源，独立校验单 coverage 和目标镜头，已有单元关联用 some 判断；不改选、不拆分、不新增生成能力。未知原请求仍可重放原冻结授权。
- 最新 graph 完整通过：`jellyfish-canvas-graph-YdEns3`（缺失图、跨镜头 AI 门禁、恢复、旧图移除、字段、配置、真实图片、导航等全旅程）。最新 AI 完整通过：`jellyfish-scene-version-UNRwnS`。
- 视频浏览器先按新真实控件适配旧单元标签及选择弹层（保留全部业务断言），再增强起点为实际选择模型、填写时长、上传／绑定参考。最终完整通过：`jellyfish-scene-version-dcS5E7`；包含正文核对、六岗检查、未知保存并生成／重放、其他单元继续编辑、候选真实播放／失败重试及不自动采用。
- A01–A20 与复用／范围审计汇总到 acceptance.md。当前剩余最终两轴审查、相关修复、票据／计划结项和当前分支提交，目标仍 active。本轮测试句柄待最终收齐后记录，不提前结项。

## 首次提交与两轴审查

- 作为固定审查点，已在当前 codex/0718 提交 `06f79c1b7ca6b38798d39401517d91bb82c4cb4a`（[feat] 共享 graph 契约与单元画布改造）。本地提交不代表最终验收完成；goal 仍 active。
- 全仓最新后端验收结束：786 passed、19 skipped、140.79s，退出成功。这包括最终计数与 legacy 身份测试。此后仅修改前端入口和浏览器，后端代码未变。
- 已按 code-review 技能显式授权的两轴并行审查执行，固定基线 d264de4738484306d5b1b17ad588803546d31ac6...HEAD（审查 HEAD 为06f79c1）。Standards 2 项（P2 根视图固定 scene、P3 当前单元按钮未共享），Spec 2 项（P1 未保存导演对象关闭后无法重进、P2 新单元首次保存前参考入口不可达）。两轴原报告分别保存在 review.md，没有合并或跨轴排序。
- 已修 Standards P3 与 Spec P2：当前单元设置和参考入口使用 WorkbenchButton；参考直接打开同一 ReferencePicker，支持 graph 尚无该单元时实际上传、绑定。浏览器先红 vQZjKH，修复后完整通过 `/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-canvas-graph-LBdClK`；新绑定随首次失败内容保留、关闭恢复，保存后撤销移除的旧图参考入口仍明确不可用。撤销测试通过公开控件逐步回退到创建前，重做准确恢复，不依赖私有 history。
- typecheck、diff --check 通过；已查看 LBdClK/unit-graph-mobile.png，390px 下当前单元选择／设置／参考／新增入口正常换行且不覆盖下方工具栏。
- 本轮所有执行测试句柄与两个审查者均已终态。06f79c1 后工作区尚有前端入口修复、浏览器、acceptance.md 与新 review.md，未提交；票据和计划未结项。

### 下轮明确接续

1. 修 Standards P2：两类包装保护、directorCanvasProjection、UnitGraphCanvas 仍硬编码根视图 scene。应消费后端 `parent_id == null` 的真实根地址；扩充现有不透明 ID 浏览器为根视图和导演子图重命名（同时改 view.parent_id／entry_view_id／node.home_view_id），先红后绿。导演 geometry 的 legacy overview 可保留在适配中，但有效视图、子图布局与预览不能继续假设后端 shot:<id> ID；当前 DirectorDesignCanvas 的 viewId 在 projection 之前，可移到 graph.metadata 得到后按真实视图确定，保留旧 root overview 缓存映射。共同契约是否需显式唯一根约束按现有 parent_id 语义收敛，避免从多个根任意选一个。
2. 修 Spec P1：新增导演对象不在已保存 projection.objects 中。提供只用于编辑选择的当前未同步对象入口，复用 designObjects(current)／targetFor／edit，不能加入临时 graph。建议在已有附加信息内列出当前对象中未出现在 projection.byKey 的项目，明确“编辑待同步对象”；关闭详情及首次保存失败后可重新打开。需浏览器创建空版本 → 添加首镜头 → 填写 → 关闭 → 422 保存失败 → 当前编辑选择入口重新打开，证明服务器仍无镜头、graph 无假节点。currentObjects 只用于编辑，业务 graph 仍由后端决定。
3. 后续自审需核实相关详情消费者：DesignObjectSummary.tsx:71 调 designCard(value,object,saved)，只覆盖 card.scope；designCard.ts:45 后仍以 directorDesignGraph／shotGraph 从原内容计算 card.shots。母规格 02 要求“导演相关详情、来源和检查消费者完成迁移”，且后端负责关系。判断该当前编辑摘要是否仍有重复关系推断；如需调整，有 supplied relationshipGraph 时应使用其 node.shot_ids／edges／paths／placement，不在已迁移详情走旧前端连通性算法；其他未迁移旧消费者按范围保留。不要把当前字段文字格式化等编辑行为错误移出前端。此项为待核实边界，未作为两轴原报告中的第三项。
4. 修复后运行受影响浏览器／类型（共享根契约若变则相关后端及 Pylint、必要 OpenAPI），固定修复提交，用同一基线对两轴复查。然后按 acceptance.md 和票据条件完成结项记录／计划状态及最终提交，再做完成审计。不要把初次矩阵“已执行通过”误当作审查通过。

## 审查修复与详情范围核对

- Standards P2 已修：两类画布按唯一 parent_id 为空的根视图定位；布局适配仅保留既有 overview 缓存键，真实子图地址来自 graph。公共契约拒绝多个根，OpenAPI 与客户端同步。根及导演／单元子图重命名的浏览器先红后绿。公开契约 26 passed，全部 directing 503 passed、15 skipped，Pylint 10.00。
- Spec P1 已修：附加信息新增“编辑待同步对象”，只读取当前编辑对象登记表，不创建图节点／边。空版本新增首镜头、关闭详情、422 失败后重新进入，原输入完整；服务端和 graph 仍无镜头。完整 graph 浏览器 WxCIl6 通过，同时覆盖前轮未保存单元参考和关闭恢复。
- 自审确认详情的 card.shots 仍调用旧连通性推断。真实锚点由调度引用时，后端全场背景却被详情宣称影响镜头；6JN77V 红例复现。已迁移详情改为消费 relationship_graph 的 shot_ids／placement／edges／paths／reason；当前字段及编辑校验保留，不把引用当作执行归属。详情文案改为“当前输入”，不引入草稿。设计范围完整浏览器 gYn88w 通过。
- 最新 typecheck 与前端纯逻辑全集 182 passed；diff --check 通过。导演布局回归和后端最终全量正在执行，后续记录终态。

## 最终全集与第二次复查

- 后端最终全仓 788 passed、19 skipped、142.17s；19 项为未显式配置的 directing／task MySQL 与真实对象存储集成用例，不涉及本轮新逻辑跳过。前端纯逻辑仍为 182 passed、0 failed，typecheck 通过。
- 导演布局完整回归 ILmQjo 通过；此前首次启动与设计范围浏览器端口冲突，结束后串行重跑，最终没有残留测试进程。
- 固定修复提交 a3ad716 后，Standards 复查通过、无新增发现；Spec 原两项已修复，但发现重复无 ID 历史行编辑后旧快照误匹配另一行。保留为待修 P1，不提前结项。
- 正在隔离浏览器数据中加入真实无 ID 重复活动行，验证首行编辑／422／关闭后，旧卡不匹配第二行，当前选择入口可分别继续编辑两行；不新增持久身份或领域草稿。
- 历史无 ID 重复行独立浏览器红例 vlYsA4 已直接复现旧卡仍可错误编辑。投影现在先检查保存基线是否有重复快照；重复时只有整个列表仍相同才允许按原出现项进入，不将剩余匹配提升为身份。当前“编辑待同步对象”也纳入无法映射的历史行，明确选择当前内容后复用同一详情。
- 独立浏览器 yk4uSV 通过：第一行修改、422、关闭后旧卡禁用；当前入口重开第一行继续修改，再打开第二行内容未变；正式 HTTP 回读仍为两个原始旧行，没有偷偷保存或补 ID。最新 typecheck、diff --check 通过。完整 graph 回归正在运行。
