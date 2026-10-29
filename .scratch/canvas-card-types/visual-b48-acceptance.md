# 48：B「素材编排」图片对照与完整旅程验收

日期：2026-10-29。独立分支 `codex-b48`，实施起点 `634f8a36`，前置43–47均已集成。此记录属于本轮新验收；01–42与历史验收文件保持原样。当前结论为实施和定向验收通过，等待集成及最终双轴审查；不以旧功能通过代替B图片验收。

## 实际发现与修复

| 问题 | 红灯证据 | 最终行为 |
| --- | --- | --- |
| 摄影／风格窄屏应用动作需滚动才能看到 | `/private/tmp/canvas-b48-actions-red`，默认390视口应用动作不在可见区域 | 操作条移到当前生成画布编辑容器正文之外的固定footer，同一React实例、局部主题和焦点顺序；只承载现有预设应用／暂不应用，不新增整卡事务。早期sticky虽可达却遮住列表，已由不覆盖正文的footer取代。 |
| 多来源模型依据把参数／提交推离默认首屏 | `/private/tmp/canvas-b48-multi-red2`；实际组合图journey-third也可见 | 依据栏独立有限滚动，已采用标签保持正常行高并独立滚动，提示词长文内部滚动。默认与窄屏多来源均不滚动整个编辑器即可看到提交。展示先放真实媒体但仍标原采用序号，未改编译顺序。 |
| 默认导演依据摘要露出内部对象身份 | `/private/tmp/canvas-b48-multi-red`，默认摘要含对象UUID | 从直接输出的design.fields和photography.entries／实际采用范围派生短摘要，复用原字段状态摘要；名称来自本卡人类字段、直接命名图片输出或目录标签。完整canonical输出／身份仍在明确“查看来源”中，不用正则修改用户文字，不改保存、输出或编译。 |
| 部分旧旅程仍假设候选／输出常驻 | `/private/tmp/canvas-b48-affected-red`的Sessions超时 | Sessions、Autosave、MultiView、VisualPresets、Alignment仅补真实打开按需区域的动作；保留输出选择、媒体时间、迟到SSE、保存修订、局部范围与诊断等旧断言。 |

固定footer的真实页面还验证了：触摸应用能更新本卡；普通字段仍自动保存；遮罩／Escape关闭和切换到模型后无旧动作残留；Tab从末尾动作回到当前Modal关闭按钮、Shift+Tab返回；同浏览器第二标签页只读时应用被禁用，触摸不会改变HTTP修订。

## 三方图片对照

主来源为 `codex-prototype-canvas-visual@5d649b49`，B原图和用户原图路径完整列在 `/private/tmp/canvas-b-visual-sources.json`。对照时使用暗色主题、100%画布比例、真实有内容的摄影卡＋角色参考编组＋生成模型，默认模型实际采用五份来源；其他真实卡片仍保留在画布中。视图缓存仅用于可重复布置，不改业务数据。不是清空数据或隐藏管理功能获得的截图。

已实际查看用户模型输入／相机卡原图、B-canvas／B-photography、正式全页及原尺寸区域图。3830全页另看编辑区和Modal区域，未仅凭缩小联系图判断。下表是逐区域结论；图片替换、内容量和真实能力差异明确保留。

| 区域 | 用户／B依据 | 正式图片（最终B组合旅程） | 判断及明确差异 |
| --- | --- | --- | --- |
| 模型表面 | [用户输入区](/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/codex-clipboard-a6c31933-5207-4f5f-9d5b-53d1e4003a3e.png)、[B画布](/private/tmp/canvas-visual-prototype-preview/B-canvas.png) | `b-canvas-1440.png`、`b-composer-1440.png`、`b-submit-1440.png` | 通过：单一约700px表面、1:3依据／输入、真实图片缩略、短标签、底部参数与浅色圆箭头，候选和历史默认按需。五份真实采用较B示例多，采用区域滚动而不挤掉提交；实际模型参数保留，不新增品牌／计费。 |
| 摄影卡与编组 | [用户选中相机卡](/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/codex-clipboard-82f30349-4068-4508-bef7-210f677e196c.png)、B画布 | `b-canvas-1440.png`；44原尺寸卡图及46组管理图见下方覆盖 | 通过：图标标题在主体上方、原创光学图解＋真实关键值；编组默认只有框外图标名称、边框与轻背景，无常驻表单／白柄。真实字段替代参考中的商业镜头／光圈，不虚构硬件字段。 |
| 摄影／风格Modal | [用户相机Modal](/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/codex-clipboard-a35bba97-5781-4871-8ed8-02a329aca12f.png)、[B摄影](/private/tmp/canvas-visual-prototype-preview/B-photography.png) | `b-photography-1440.png`、`b-photography-region-1440.png`；presets-final的`style-compare.png`／五区图 | 通过：大预览在左、视觉选择和真实关键设置在右、专业字段按需；固定动作在正文之外。原创街景SVG／运镜演示替代第三方照片；字段／预设数量来自真实目录，保留区域切换和必要关系入口。 |
| 窄屏 | 同上B区域层级，按规格单列适配 | `b-canvas-390.png`、`b-composer-390.png`、`b-photography-region-390.png` | 通过：上方保留采用依据，输入和参数／圆提交在后；摄影先预览再设置，标题／关闭／应用固定，正文滚动且不横向越界。保留既有移动端添加／连接入口。 |
| 大屏 | 同上来源，有限尺寸而非全屏撑大 | `b-canvas-3830.png`、`b-composer-3830.png`、`b-photography-region-3830.png` | 通过：原始3830×1688页面保留画布范围，700px编辑区和受限Modal不无限放大；原尺寸局部确认标签、圆角、字体和动作可读。 |
| 导入／加号／组织状态 | 用户左右点／编组图、B画布 | 47的`themed-text-import.png`、`hover-plus-100.png`／`focus-plus-100.png`及46组／堆叠图 | 沿用已实测前票证据：暗色导入触发和反馈，30px圆圈＋16px加号，悬浮／焦点／选择可辨；组／stack状态未被本票修复改变。完整生产旅程继续实际使用导入、连接和组，不只列样式数值。 |

最终组合旅程证据目录：`/private/tmp/canvas-b48-official-journey/generation-canvas-journey/`。同一脚本合回正式入口前的完整绿灯、已实际查看的对应全页／局部图在 `/private/tmp/canvas-b48-journey-release/`。主代理亦实际查看该目录 `b-canvas-1440.png`、`b-composer-390.png`及固定footer390图，确认之前的裁剪、标签压扁和默认身份泄露已修正。正式统一入口preflight与Journey通过，旅程耗时63.1秒；重跑后再次实际查看正式1440全页与390摄影区域图。先行临时脚本结果不冒称正式入口执行。

测试图片中：上传的街道构图PNG是测试现场绘制的原创示意；正式模型结果红／绿／蓝色块来自受控供应商fixture，不代表模型艺术质量。摄影演示是合法原创产品示意，明确标注，未成为项目资产或自动进入模型输入。未合入原型开关、照片、固定品牌参数或假业务状态。

## 状态及业务覆盖矩阵

| 需要覆盖的路径 | 当前证据与实际结果 |
| --- | --- |
| 未采用／空素材／三模态／展开同会话 | `canvas-b48-material-regression`通过；43同一公开旅程覆盖空态、图片／文本采用、展开、窄屏及文本／视频同表面。正式组合图覆盖五来源，默认管理收起。 |
| 多来源、长名、长正文、加载、失败和只读 | `/private/tmp/canvas-b48-states-release`通过；`model-long-input.png`、`model-precheck-loading.png`、`model-error-summary.png`、`model-readonly-disabled.png`逐张实际查看。预检HTTP被延迟时真实loading禁用；供应商503形成真实失败摘要；第二标签页只读禁用。长文字保存精确原样，canonical身份仅明确展开可见。旧final目录6.9秒结果只覆盖基础multi断言，未冒充新增四态执行。 |
| 摄影五区／风格比较／应用取消／专业字段与状态 | `/private/tmp/canvas-b48-presets-final`通过；五区、运镜播放／起止、大预览、风格比较、取消不撤销已保存字段、HTTP回读、专业说明和真实Worker生成均保留。原`photography`再跑通过，局部region采用与明确结束画面、保存期间目标选择不丢。 |
| 完整生产旅程与直接一级边界 | B增强Journey通过：项目入口→文本导入→上传→名称／主图关联→表演／示例→摄影选择／字段与局部采用→模型独立采用→编组→保存预检确认→单模型三结果→历史另存→下游再预检／重开。HTTP确认名称映射、未直接采用描述／对白不跨级泄露、示例不进生成、摄影只采用光影、下游只收到直接图片而没有祖先原文。原断言全部保留。 |
| 统一无环、重复线、剪刀和删除引用门禁 | 47的integrated-prewire／integrated-ports／integrated-edges／integrated-accessible仍有效：候选循环也拒绝、多用途独立线、重复候选复用、引用未取消不可删除、键盘／触摸与只读。此后候选图／编译／删除代码未改；本票不机械重跑同逻辑全部套件。 |
| 会话、迟到响应、自动保存、修订与预检 | `/private/tmp/canvas-b48-final`中的Sessions／Autosave再次通过；媒体播放时间与选择保留、隐藏暂停、迟到SSE／输出响应不覆盖新修订、未知保存核实、立即预检刷新最新输入均保持。 |
| 名称多参考／身份稳定、文本图独立、顺序、失败恢复 | MultiView最终再次通过；NamedReferences／Mixed定向通过；`canvas-b48-composer-final`与`canvas-b48-images-final`通过，结构化引用／剪贴板、顺序、文本图片独立采用、三结果／部分失败、历史另存与单一事件连接保持。 |
| 组织、筛选和导演整卡 | Stacks／FilterHighlights／Performance／Continuity通过：只读堆叠与解除恢复、组织删除保护、筛选不隐藏成员、表演整体采用、约束状态语义保持。46组织管理的本票UI代码未再改，复用org-release／graph-final／tools-final，组合旅程实际创建同一组。 |
| 编辑容器和视觉手势 | Alignment／AnchoredEditor通过；footer修改后DirectorModal再跑通过，全部导演复杂卡、遮罩关闭、输入保留、自动保存、重开、摄影入口定位均覆盖。新的footer焦点／只读／触摸由presets-final补足。 |

## 检查与边界

- 最终新增用例登记在正式browser manifest：`generation-canvas-visual-b-states`；B全旅程合回原`generation-canvas-journey`，没有永久保留重复完整脚本。均复用browser runtime及既有真实HTTP／隔离DB／TaskWorker；仅供应商和外部存储使用受控替身。
- 统一入口：`PLAYWRIGHT_CHANNEL=chrome node front/tests/run-browser.mjs generation-canvas-journey --output /private/tmp/canvas-b48-official-journey`；其他直接脚本、统一批次results和日志目录见上文。`/private/tmp/canvas-b48-final/results.json`为五项最终定向批次，`canvas-b48-remaining/results.json`为九项其余覆盖；重复运行按唯一行为计，不用数字替代逐项判断。
- Node24 `pnpm --dir front run typecheck`、变更TSX定向ESLint、`git diff --check`通过。主代理在82f61422执行的workbench六项（`/private/tmp/canvas-b-workbench`）及单元全绿可复用：本票只改生成画布局部编辑容器／模型展示，公共工作台及画布基元未改。全量lint仍有既有Graph/useCardCandidates两条hook告警，不记录为lint通过。
- 公开接口和后端未改，不机械再生OpenAPI或执行无关Pylint。01–42与历史验收46个保护文件SHA256核对不变。真实供应商质量、MySQL专属环境与未配置的真实外部对象存储不在此次受控验收结论内。
