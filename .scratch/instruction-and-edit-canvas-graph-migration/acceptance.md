# 指令与剪辑画布 graph 迁移验收

本地任务系统的交付证据；父规格保持不变。前置票据01–06的Comments记录各切片TDD、具体命令、截图目录与固定输入回归。以下按同一最终组合核对A01–A24；引用前置通过结果时不冒充本次重跑。

## 验收矩阵

| 条目 | 可观察行为 | 本轮执行／明确复用来源 |
| --- | --- | --- |
| A01 | 四图／内容／元数据同快照 | 本轮全量HTTP/graph；版本HTTP、共同graph contracts；最终directing全量 |
| A02 | 重复／悬空／循环／跨快照拒绝 | 本轮全量；共同graph contracts、缺失Take占位HTTP、seam合法ID碰撞回归 |
| A03 | 合法未准备内容可展示 | 复用01/02；本轮正式canvas-graph；01指令HTTP、02unit_scope证据HTTP、sceneCanvasGraph |
| A04 | 当前明确单元与精确任务 | 本轮新导航/旧导航；复用01/02任务回跳；sceneInstructions、sceneInstructionSuggestions、sceneCanvasNavigation、sceneGraphNavigation |
| A05 | 实际依据及参考顺序 | 本轮共享来源/新导航；复用01/02依据；test_canvas_graph、sceneInstructionEvidence、sceneSharedNavigation |
| A06 | 全文／明确应用／撤销 | 复用01/02 Comments已通过结果（全文/明确应用/撤销实现未变）；sceneInstructions、sceneInstructionSuggestions、sceneInstructionEvidence |
| A07 | 依据／检查／生成状态分开 | 复用01/02依据；本轮instruction-evidence精确记录／在途应用回归；sceneInstructionBasis、sceneInstructionChecks、sceneInstructionSuggestions原请求路径（复用02完整流程） |
| A08 | 整场默认图与全部候选 | 本轮正式graph；sceneEditGraph、sceneTakeLibraryGraph、sceneTimeline |
| A09 | 复合Take及独立clip | 本轮正式graph/新导航；sceneEditGraph、sceneLegacyTakeLibrary、sceneGraphNavigation |
| A10 | 覆盖／可用区间／采用独立 | 本轮正式graph；sceneTakeLibraryGraph、sceneTakeLibrary与对应HTTP |
| A11 | 占位／留白／真实接缝 | 本轮正式graph；复用05原接缝；sceneTimeline、sceneSeamReviews及接缝HTTP |
| A12 | 相关依据失效／整体平移 | 本轮全量HTTP/正式graph；复用05原审查；接缝HTTP、sceneEditSeamsGraph、sceneSeamReviews |
| A13 | 摘要与按需历史固定 | 本轮正式graph/总览历史；复用02建议检查固定输入；sceneInstructionEvidence、sceneEditSeamsGraph、sceneEditCutEvidence、原审片browser |
| A14 | 图／树／任务一致对象无副作用 | 本轮新导航；复用02任务回跳；sceneGraphNavigation（opaque四图、同Take两clip）及sceneInstructionSuggestions任务回跳 |
| A15 | 精确返工与明确操作 | 本轮正式graph；复用06原落幅/后段/整场流程；sceneEditCutEvidence、sceneCutReviews、sceneEndFrames、sceneFrameDependencies |
| A16 | 同revision刷新外部证据 | 本轮正式graph；sceneInstructionEvidence、sceneTakeLibraryGraph、sceneEditSeamsGraph、sceneEditCutEvidence |
| A17 | 新增／删除待保存 | 本轮正式graph/新导航；复用01首次保存；sceneInstructions首次保存同DOM、sceneEditGraph删除、sceneTakeLibraryGraph失效覆盖、07待同步单元入口 |
| A18 | 在途编辑／迟到保护 | 本轮立即应用竞态/正式graph/新导航；复用01长文在途；sceneInstructions、sceneInstructionEvidence乱序及apply在途、scenePeriodicSave、sceneGraphNavigation跨图草稿 |
| A19 | 成功保存但graph响应失败 | 复用01缺图原请求核实；本轮canvas-graph故障恢复；sceneInstructions缺instruction_graph保存响应、原请求核实重放；sceneCanvasGraph共同恢复 |
| A20 | 失败／冲突／关闭恢复／所有权 | 本轮sceneVersionWorkbench完整流程boaRnh及正式graph；scenePeriodicSave、sceneCanvasGraph、sceneVersionWorkbench；沿原保存队列与本地恢复机制 |
| A21 | 媒体／外部失败保持身份 | 本轮正式graph；复用05/06原媒体故障恢复；sceneTakeLibraryGraph、sceneSeamReviews、sceneEndFrames及sceneInstructionEvidence |
| A22 | 往返／四图／只读历史 | 本轮新导航/旧导航/共享来源/总览；复用01–06固定历史读取；sceneGraphNavigation、sceneCanvasNavigation、sceneSharedNavigation、sceneOverview与原历史浏览器 |
| A23 | 1440／390／键盘／长文 | 本轮正式workbench/新导航；复用01长文与选区；正式workbench suite、各新graph browser、sceneInstructions长文与选区 |
| A24 | 共用基础设施及原流程 | 本轮最终组合；正式graph suite、正式workbench suite、最终typecheck/Pylint/directing/unit/lint |

## 07新增证据

- 真实浏览器基线红灯：`PVqDNR`，关系树仍有独立素材刷新入口，断言1≠0。实现删除独立Take请求并沿版本图消费成员、真实边、身份和摘要；总览只安排几何列。
- `sceneGraphNavigation.browser.mjs`：不透明四图地址、已保存关系与当前输入分离、同一Take两次采用的精确第二片段、树与总览一致回跳、键盘明确单元导航、跨图未保存正文、无播放／无服务端内容变化。最终证据`2kBSjW`：额外验证已保存长正文原位展开／收起、定位菜单Escape关闭、总览稳定对象选择跨明确保存revision保留；每次新执行由日志给出具体目录。
- 关系详情不再被树覆盖，树暂隐藏但原触发器DOM保留，避免返回时焦点丢失。原共享来源和历史完整读取继续用既有browser回归。
- 窄屏只有一个可见toolbar；文档高度与viewport高度均844，无横向溢出。固定工作台采用viewport截图，并等待响应式布局的两帧与有限动画完成；未稳定时的Chrome截图有重复fixed栏残影，稳定后的最终截图仅一套栏。DOM断言与实际截图共同核对，不能仅用早期残影证明产品重复栏。
- 共享定位Dropdown显式管理开关，菜单选择与Escape都关闭；不遗留悬浮列表遮住图。原四panel仅保留稳定业务操作工作区几何，缺少可靠映射的容器布局不迁移到新业务节点。

## 最终检查

- 后端：`pytest tests/directing -q` **507 passed / 15 skipped，156.52s**；`uv run --no-sync pylint app` **10.00/10**。07后端仅清除06的EOF空行，未改业务规则。
- 前端typecheck通过；`test:unit` exit0全部通过。`lint:check` **295项已知 / 0项新增**，仅删除3条已修复存量基线，无新增接纳。
- Hugo站点构建通过（157页）；4347本地预览经真实Chrome读取HTTP200、正确标题及新增章节内容，临时服务已停。
- 正式graph使用相同注册case/端口/timeout分段运行：`browser-diN279`通过前10业务case（graph-navigation、director-layout、canvas-graph、graph-summary、legacy-graph、periodic-save、instruction-evidence、edit-graph、edit-seams-graph、edit-cut-evidence），仅后续timeline因旧独立刷新夹具失败；修正后`browser-KkCmOv` exit0通过graph-navigation、timeline、take-library-graph、take-library、legacy-take-library。未声称单次全套exit0；所有14业务case均有正式runner通过证据。
- 本轮独立原流程：`sceneVersionWorkbench` **boaRnh**（所有权／交接／未响应／关闭恢复／未知请求／冲突）；`sceneCanvasNavigation` **2yJ7YM**（60镜头、跨镜头明确单元、多单元记忆、长文390px）；`sceneSharedNavigation` **OZSu9g**（固定来源、只读历史、失败重试及焦点恢复）；`sceneOverview` **QrqWWP**（明确完整历史动作、固定输入与失败重试）。
- 07未改变对外schema，OpenAPI/client承接06在批准8088上的实际生成；没有无谓重生旧接口。
- 正式workbench最终实际代码：`browser-uRvHsN` **exit0**，preflight、workbench-ui、workbench-style（62.3s）、design-scope（15.1s）全过；1440/1280/390、真实媒体、键盘菜单与未保存输入。最后`browser-H2ehJA` **exit0**，原take-library（29.5s）再次通过失败保持阻断、成功重试、真实媒体／覆盖／跨版本判断。

## 验证边界

15项skip沿现有测试条件保留，未宣称通过。浏览器使用本机Chrome与隔离SQLite服务，真实媒体解码／播放沿现有fixture；模型供应商边界使用受控任务结果。未执行真实付费生成、生产数据库或线上部署。未改变保存接口、graph草稿或历史固定输入；未发布PR或push。

## 组合回归发现并修复的问题

- 正式canvas-graph的缺失unit_graph故障夹具先令新关系树崩溃；关系树改为图不可用提示，保留主编辑器的原错误恢复，不重构临时业务关系，L7saND与diN279已通过该公开路径。
- 定位菜单的requestAnimationFrame无条件抢回拖动柄，覆盖用户更新的明确按钮焦点（R7GGIo）。回调现在只在焦点仍为原目标或body时聚焦，新的明确焦点优先。
- 不加等待的原edit-graph路径在背景素材刷新期间点击应用被瞬间disabled吞掉（x4N7of）。修复后台刷新保留已核实素材的本地编辑，首次无数据／失败仍阻断；原立即应用路径yrROqn通过，未用延时或等待响应掩盖操作丢失。
- 既有样式夹具同步默认新剪辑图入口，并只测量可见surface的几何与其内容transform；保留原媒体、菜单、键盘和未保存输入断言。总览夹具不再期待已移除的独立素材请求失败，改验证保存图仍可导航、完整历史独立失败与重试；最终内容/revision不变，外部任务证据允许更新。

- 素材库重试保留已有错误直到重新读取成功，不能在失败后的重试启动时短暂解除编辑阻断；成功更新仍按原复合Take身份匹配，未找到原目标不替换。
- 总览任务历史由“查看完整任务与检查历史”明确打开；只选业务对象只显示当前graph摘要，不自动加载全部历史正文。

正式runner与最终桌面／390px截图已复制到 `/tmp/jellyfish-canvas-navigation-07-evidence-rsgnae0l`，避免ignored测试产物随实现worktree归档丢失。各results.json保留原目录并指向副本，run.log保持原始输出；graph第一段的失败及后续修复不删除。最终导航截图已实际查看（包括定位菜单关闭、无重复toolbar）。

## 正式两轴审查修复

修复分支基于 `f9092e2f010878e762df1cc5752a53d24d5be162`，父规格未改。Standards 的三项硬规则及重复比较建议、Spec 的两项历史读取边界均落实到代码。

- 历史素材审片的原生 summary 恢复 Tab 顺序。素材图浏览器建立三份固定记录，当前 graph 不含中间旧记录；实际 Shift+Tab → Tab → Enter 仍能进入并打开第2条历史（`UZBnSy`），固定来源、媒体播放／暂停与未保存判断保留。
- 指令卡和整场验收卡固定有限尺寸，字段最多两行。指令记录通过明确选择定位原建议／检查；整场问题保留全部片段身份的选择入口，完整长观察与所有验收条件从原整场验收阅读。`sceneInstructions`（`xsc8xv`）验证长正文保存、同一编辑器与选区、有限摘要及操作未被挤出、缺图恢复、390px；`sceneInstructionEvidence`（`9izqYq`）验证原记录、同 revision、迟到响应与应用在途。
- 新图动作采用 WorkbenchButton；保存与素材复核共用最小 sceneContentKey 默认值归一化，原 participant_ids 语义与数组顺序保留。官方 lint 基线仅移除1条已修复旧项，不接纳新问题。
- 隐藏剪辑工作区不加载完整 cut/seam/end-frame 历史；明确原记录、完整历史或审查动作才读取。graph/revision 更新不重新取全部历史，已打开表单保持挂载。新验收浏览器红灯观察默认三种历史各2次 GET；绿色验证默认三种均0次、原验收动作只读取 cut、graph 刷新无额外历史 GET 且 dirty 表单同 DOM，40条长问题仍有限、first/second 两个问题目标精确定位（`muiafd`）。
- 普通版本和列表通过 basis_key 索引预选最新与最近适用记录，不再流式扫描历史完整正文。`b4e8f2a6c735` 在明确升级时分批回填旧数据后设 NOT NULL；普通读取无扫描回退。迁移测试覆盖72条旧无索引记录、多批回填、默认值与键序、1/1.0 等价、升级及安全降级。HTTP覆盖36份其他依据后的无匹配、恢复最早适用记录和版本列表；复制仍使用显式白名单。部署前必须先在 backend 执行 `uv run alembic upgrade head`，详见共享 graph 指南升级章节。

最终后端 directing **509 passed / 15 skipped（160.60s）**，最终 Pylint **exit0 / 10.00**（根代理在同一冻结代码独立执行）；前端 typecheck、unit、lint:check 全通过，lint **294项已知 / 0项新增**。原整场／接缝／落幅浏览器按明确历史入口保留全部原断言，分别通过 `sloUdZ`、`WBv7yc`、`TRmYe0`。未改变对外 API schema，无须重生 OpenAPI。未运行生产数据库迁移、MySQL服务或付费生成，原15项跳过不计为通过。

截图与日志在 `/tmp/canvas-fix-*.log`、各 `/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-<证据ID>/`。Chrome 定位菜单 DOM 隐藏后的合成残影不作为视觉通过证据；最后另用新页面直接恢复布局和真实键盘平移查看有限卡，保留原失败日志，未改 DOM 或截图样式。

最后视觉及完整增强流程 `SFkA2o` exit0，桌面与390截图已实际查看：40问题计数、目标选择与原验收按钮均完整可见，无菜单残影。窄屏通过原缩放按钮明确切到80%，用真实方向键平移后阅读整卡；未修改DOM、截图样式或业务布局。最终截图与日志副本在 `/tmp/jellyfish-canvas-review-fix-evidence/`。
