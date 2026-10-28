# 19: 完整创作旅程与复用边界收口

**What to build:** 用户从项目进入完整画布，组织对象、参考和导演设计，生成并继续使用结果，重开后恢复真实状态；各类型共用一套契约且既有场次工作台保持原行为。

**Blocked by:** [02 项目入口与独立工作台页面](02-standalone-workbench-page.md)、[13 画面风格与可视化预设](13-visual-style-presets.md)、[15 对白与声音设计](15-dialogue-sound-design.md)、[16 空间规则、连续性与不可改事实](16-continuity-facts.md)、[17 创作控制、生成指导与验收要求](17-creative-guidance-acceptance.md)、[18 混合管道运行与引用生命周期](18-mixed-pipeline-lifecycle.md)

**Status:** ready-for-agent

**Completion:** integrated

- [x] 完整旅程串起项目进入、新建／选择画布、内容导入、对象和命名参考、导演设计、明确采用、预检、生成、结果另存／下游使用与重开恢复。
- [x] 逐项核对 39 行目录覆盖：11 类基础内容、3 类模型生成、25 项导演功能入口；不把目录行数当作物理卡片／数据表数量，摄影仍是单一内容所有者。
- [x] 逐项核对 28 类输入端点、9 行输出目录、19 条连线规则与 19 行覆盖矩阵；同时存在的来源和接收方实际可连接、选择、保存和用于相应流程。
- [x] 补齐跨票组合检查，特别是镜头到摄影、对白到表演、事件到调度／活动，以及验收要求到各使用方；不能以类型声明存在代替实际关系可用。
- [x] 组合核对表演及其他导演整卡采用、摄影局部范围、图片结构化目标、多角度同身份和三类关系，不发生跨级读取、候选自动采用或自由文本阶段推断。
- [x] 完整页面中的长文、媒体、浮动详情、弹窗、键盘与窄屏操作保持工作台约定；约 1 秒保存与运行回执不互相覆盖。
- [x] 前后端公开契约和生成类型一致，清理本次遗留的类型名称推导、重复采用状态或临时双轨行为；不顺手重构无关模块。
- [x] 既有场次工作台、项目资产和任务中心的职责保持不变，不新增章节绑定、导演试点、其他画布迁移、音频生成或 Take／剪辑流程。
- [x] 记录实际完成的行为验证、失败或限制；前序票独立完成自己的可观察闭环，本票不代替全部基础验证，也不将未确定的测试环境或接缝预记为通过。

规格依据：[总体规格](../spec.md)。共同约束与验证边界见[任务索引](../README.md)；本票实现与实际验证见下方 Comments；implemented 表示等待集成，环境未执行项如实保留。


## Comments

- 2026-10-29：从集成 `d860ad66` 在独立 `codex-canvas-types-19`／`/private/tmp/jellyfish-canvas-types-19` 实施，完成前合入主区最终 `4267b04c`。沿已确认 HTTP＋真实页面接缝逐项红→绿，供应商／外部存储使用受控替身；未新增章节绑定、导演试点、音频生成或 Take／剪辑流程。标准分诊 Status 不变。
- [实现覆盖核对](../implementation-coverage.md)逐项记录39行目录、28类逻辑输入、9行输出、19行接收矩阵和19条规则。公开 `/{canvas_id}/catalog` 从实际卡类构建35个物理类型及摄影五入口；30个物理输入中的关注／焦点属于作用对象的具体用途，覆盖28类逻辑端点。后端图校验与公开接受值种类复用同一规则；前端 generated client＋Context 消费目录，删除独立完整端点／模态／分组推导表。目录失败可重试，未核实不开放卡片编辑；模型能力与实例动态范围保持独立，无万能表单引擎。
- 修正四处组合缺口：对白新增独立 `dialogue_reference`，表演只带身份／版本／说话对象，完整正文须模型另行直接采用；创作依据 `basis` 输出保留只读来源／选区，编译仍只使用正文；通用素材增加本卡设计字段定位及非法字段校验，空间素材可选正反用途，示例不跨级；断边保护精确匹配接收用途，同源另一用途已采用不阻断删除纯候选。导演详情补可折叠候选连接管理，使实际断边／重排可操作。`CanvasResolvedOutput.modality` 公开限定四类，缺失业务引用保留文本不可用占位，关系值种类不冒充第五模态。
- 真实键盘回归另复现输入光标问题：键入“开头 @图片1 结尾”得到“结尾开头 @图片1 ”（`/private/tmp/canvas19-caret-red/generation-canvas-video/reference-caret-dom.txt`）。父层回填 binding_id 触发完整JSON差异与第二次 draw；修复后按内容／来源决定 DOM 重建，按片段ID同步最新绑定元数据且不无条件覆盖相同标签。继续键入、四指令顺序／引用数量、IME／剪贴通过。预检通过关闭生命周期后定位真实片段，恢复浮动详情中的指令／正文诊断聚焦。
- 实际截图确认模型输入框白底与工作台冲突，显式 workbench 外观复用共享tokens／按钮，默认实验外观保持；Composer颜色断言先红255再绿27。候选来源改为自身名称／标题或目录标题＋短ID；对白操作的长UUID缩短展示并保留完整title，窄屏滚动正文与页面均无横溢，portal提示不误当成正文宽度。截图已实际复核。
- 后端全部画布 HTTP／真实 TaskWorker：**275 passed／28 skipped**（31.25s）；后续仅将图诊断用词改为准确“值种类”，相关 API／Catalog／Compiler **42 passed／1 skipped**（3.68s），Pylint **10.00/10**。Node24.22.1 `pnpm --dir front run typecheck` 与差异检查通过。生产 app 导出、提交 OpenAPI、隔离8303真实HTTP schema精确一致（HTTP仅剔除测试控制路径）；证据 `/private/tmp/canvas19-production-openapi.json`、`/private/tmp/canvas19-journey-release/generation-canvas-journey/openapi.json`。generated client同步并剔除纯尾空行漂移；主区标准8000 `openapi:update` 留待集成后执行，不将未集成主服务当作当前WT契约。
- 新完整真实Chrome旅程 **47.5s**：项目真实标签进入完整画布、新建、文本导入／来源、人物描述、图片上传、命名参考、表演／对白直接关系、表演及锚点字段素材定位、候选与实际采用分离、预检、实际图片Worker三结果、历史另存、新下游独立采用／仅执行下游预检、重开与390px键盘。断言对白只在模型直接采用后出现一次、上游外貌与示例不透传、名称映射只用明确图片；来源自身名称与35类型／39入口也在真实页断言。证据 `/private/tmp/canvas19-journey-release/generation-canvas-journey`；`catalog.json`、`runtime.json`、`submitted-text.txt`、桌面／模型窄屏／表演窄屏截图及正文几何JSON保留。
- 共享目录影响的现行20个真实页面均通过：guidance15.5s、continuity13.6s（`/private/tmp/canvas19-regressions-final`）；visual-presets11.1s、narrative14.5s、mixed7.4s、spatial12.2s、sound11.2s、photography11.6s、performance13.1s、multi-view17.7s、named-references17.1s（`/private/tmp/canvas19-regressions-remaining`）；images11.6s（`/private/tmp/canvas19-images-human-labels`）；Composer9.1s（`/private/tmp/canvas19-core`）；graph13.9s、media9.1s、autosave18.0s、save9.0s、独立canvas7.0s（`/private/tmp/canvas19-core-remaining`）；video13.1s（`/private/tmp/canvas19-video-complete`）和 caret修复后VideoBindings12.8s（`/private/tmp/canvas19-video-bindings-final`）。未修改公共工作台Details／Theme／Modal，不无谓重跑无关场次六套。
- 原版六用例仍按旧卡内编辑／运行布局操作，已由独立辅助WT仅迁移测试到真实浮动详情，保持运行／取消／目标／历史／恢复断言，并合入测试提交 `54e48736`（本分支 cherry-pick `1e648875`）。其中 acceptance6.4s、lifecycle8.7s、target7.7s、runtime10.4s、history14.3s 真实通过，证据 `/private/tmp/canvas19-legacy-suite-migration.md` 及其中独立结果目录；同产品分支已包含 `c1a7230b`，后续 caret 相关影响由 Composer／Video／VideoBindings／最终旅程复验。`selection` 保留 `JELLYFISH_TEST_MYSQL_URL` 隔离库guard，当前未配置，只有静态详情迁移与语法检查，明确未执行浏览器，不降级到SQLite或使用用户库。累计26个真实用例通过（20现行＋5迁移＋新旅程），不是声称27个注册用例全部通过。
- 失败经过保留：默认沙箱预检权限失败后采用已授权升级本机验证；sound旧断言错误期待对白跨级正文，已按规格修正；visual旧用例在预设弹窗关闭前填写底层字段，补明确等待关闭后通过；graph旧断言使用“模态不匹配”，随新值种类语义同步；原版video先迁移详情／弹窗／历史入口，再发现并修复真实caret与诊断聚焦。首次完整旅程默认请求一图而替身固定返回三图，供应商数量校验正确阻断；改为用户在真实页明确设置三图后通过。另将错误读取snapshot.outputs的测试改为公开current_outputs，不改产品协议。上述红灯不掩盖、不记为通过。
- MySQL缺环境与受控供应商／存储限制保留；结果不证明真实供应商质量、真实外部存储或MySQL竞争已验收。未推送、未改用户主区服务；最终集成与双轴审查由主代理继续。

- 2026-10-29：主区无冲突合入 `1a2b350d`（merge `4da2f90e`），Completion为integrated，Status仍为分诊状态。合后API／Catalog／Compiler **42 passed／1 skipped**（3.63s）、Node24.22.1 typecheck及 `git diff --check`通过；产品树与验收分支一致，复用本票275／28、Pylint10及26个真实页面证据，selection隔离MySQL未执行限制不变。主区 `app.__file__`确认来自当前backend，生产导出、8000实际HTTP与提交schema精确一致；核对Catalog、BasisText、DialogueReference和四模态枚举后标准 `openapi:update`成功，440处证明仅尾空行／等价格式漂移还原。主区证据 `/private/tmp/canvas19-integrated-production.json`、`/private/tmp/canvas19-integrated-http.json`；未推送、未停止用户服务。最终双轴审查尚待执行，不预记审查通过。
