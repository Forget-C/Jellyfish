# 二级入口与四边连接交互验收（27–33）

日期：2026-10-29。范围为最新规格的二级分类入口、输出卡面、松开／长按手势、四边几何连接、用途选择、预先布线、多用途关系及浮层协作。旧 01–26 票据和布局验收记录保持原样，本记录不回写其结论。

## 验收接缝与环境

- 使用既有公开 HTTP 接口与真实浏览器页面；SQLite 隔离服务执行真实保存、编译、预检与 TaskWorker，模型供应商和外部存储使用受控替身。不宣称真实供应商生成质量或隔离 MySQL 竞争通过。
- Node 24.22.1、本机 Chrome。浏览器证据位于工作树外的 `/private/tmp/canvas33-*`；每次 runner 输出独立 results.json、run.log 与截图，实际执行前检查端口并记录环境失败。
- 测试命令为 `PLAYWRIGHT_CHANNEL=chrome node front/tests/run-browser.mjs <case-or-suite> --output <directory>`；剩余用例使用同一 manifest 的绝对路径副本排除已经通过的项，case 文件和业务断言未跳过。实际去重结果见下表。

## 验收发现与修复

1. 原完整旅程依赖单一添加按钮、35 个物理目录按钮和常驻逻辑端点。已迁移为八分类遍历 39 个产品入口、四边连接及接收端明确采用；保留原保存、映射、素材、执行和重开断言，不保留旧 UI 兼容入口。
2. 命名参考的名称已通过输入绑定采用，卡面却只读本卡独立对象并显示未绑定。真实红例 `/private/tmp/canvas33-named-summary-red`；卡面改为本卡对象和明确绑定的直接身份派生摘要，不读取描述。绿色旅程 `/private/tmp/canvas33-named-summary-green` 17.8s。
3. 原适应全部按固定范围计算，顶排可能位于悬浮筛选后。真实红例 `/private/tmp/canvas33-fit-red`；生成画布局部按实际可见卡片边界和顶部／左侧／底部留白适应，无保存布局的初始位置也留出空间。保存视角和创建时不移动视角规则保留，不改变共享工作台 hook。
4. 完整旅程等待 HTTP 预检返回后过早检查关闭，模态尚未挂载即返回，后续过滤被模态遮挡。测试改为等待公开预检对话框出现再通过关闭按钮退出，未绕过页面行为。
5. 旧端点测试在适应全部后再向下平移 180px，以绕过旧顶排遮挡。新适应全部修复后移除此补偿操作，保留全部连线、取消、采用和侧边恢复断言。

## 视觉与交互逐区核对

已实际查看 `/private/tmp/canvas33-alignment-final/generation-canvas-alignment/` 的 1440×960、390×844、3830×1688 默认、目录、菜单、详情、展开、运行、失败截图；共同区域对照本轮当前导演基准 `/private/tmp/canvas33-visual-director-baseline/`。辅助观察记录 `/private/tmp/canvas33-visual-findings.md` 中的旧顶排遮挡已经上述修复取代。

| 区域 | 核对结果与明确差异 | 实际操作证据 |
| --- | --- | --- |
| 顶部、面包屑、筛选 | 局部暗色主题、按钮层级、留边、筛选开合与工作台共同规范一致；独立画布无场次版本和四画布切换。 | 三视口截图；筛选不改输入、浮层开合不改视角断言。 |
| 左侧添加 | 八分类竖栏与二级面板为规格明确改版；图标提示、选中、搜索、空态、关闭、焦点、点击和拖入有真实覆盖。窄屏面板内滚动并保持关闭可达。 | CardList／Journey 的 39 入口检查及真实创建保存重开。 |
| 卡面与编辑 | 顶部名称、中部输出、底部弱状态；参考图显示名称与角度，模型区分临时与发布输出。正文编辑在右侧，失败保留语义。 | Cards／Sessions／Named 与三视口详情、运行和失败截图。 |
| 四边连接与用途 | 几何点替代常驻字段端点，逻辑语义保留；默认无密集字段标签，拖动有连续临时线，落点菜单在视口内。 | Ports 分段拖动截图、取消及实际 Worker 请求；EdgeManagement 独立用途与保护删除。 |
| 触摸、键盘与浮层 | 通过连接到…选择目标，添加和用途菜单互斥；窄屏暂隐详情后恢复会话，创建后打开新卡。 | AccessibleConnections／Cards／Sessions 真实操作与焦点断言。 |
| 底部工具与小地图 | 定位、缩放、布局、撤销、小地图继续沿工作台；适应全部为导航和工具留白。窄屏整图可能缩小，详细阅读通过详情或明确缩放完成。 | Tools／Alignment／Ports 同视口截图与几何检查。 |

## 实际执行结果

本轮在最终 33 产品代码上执行画布／旧实验室独立用例 **39 项通过**（按 case 名去重，排除 preflight）。共享工作台 **6 项**复用本轮未受影响实现的实际基线，共 **45 项独立真实浏览器用例**有通过证据。selection 在服务启动前触发隔离 MySQL 守卫，业务页面未执行，不计为通过。

完整套件遇失败即停后，定位并修正当前入口／公开 UI 等待，使用同一 manifest 用例的绝对路径副本续跑剩余项。以下逐项列出最终通过记录，先前失败日志仍保留，不将整次中断套件记为通过。

| 独立 case | 最终结果 | 证据目录 |
| --- | --- | --- |
| generation-canvas | passed · 7.9s | /private/tmp/canvas33-generation-tail6/generation-canvas |
| generation-canvas-acceptance | passed · 6.9s | /private/tmp/canvas33-generation-tail2/generation-canvas-acceptance |
| generation-canvas-accessible-connections | passed · 10.6s | /private/tmp/canvas33-layout-rest/generation-canvas-accessible-connections |
| generation-canvas-alignment | passed · 9.0s | /private/tmp/canvas33-alignment-release/generation-canvas-alignment |
| generation-canvas-alignment-baseline | passed · 7.9s | /private/tmp/canvas33-layout-tail/generation-canvas-alignment-baseline |
| generation-canvas-autosave | passed · 19.2s | /private/tmp/canvas33-generation-tail6/generation-canvas-autosave |
| generation-canvas-card-list | passed · 11.6s | /private/tmp/canvas33-generation-final/generation-canvas-card-list |
| generation-canvas-cards | passed · 9.1s | /private/tmp/canvas33-layout-rest/generation-canvas-cards |
| generation-canvas-chrome | passed · 6.4s | /private/tmp/canvas33-generation-final/generation-canvas-chrome |
| generation-canvas-composer | passed · 10.2s | /private/tmp/canvas33-generation-tail4/generation-canvas-composer |
| generation-canvas-continuity | passed · 13.9s | /private/tmp/canvas33-generation-tail/generation-canvas-continuity |
| generation-canvas-edge-management | passed · 12.7s | /private/tmp/canvas33-layout-tail/generation-canvas-edge-management |
| generation-canvas-filters | passed · 6.8s | /private/tmp/canvas33-layout-rest/generation-canvas-filters |
| generation-canvas-graph | passed · 14.6s | /private/tmp/canvas33-generation-tail6/generation-canvas-graph |
| generation-canvas-guidance | passed · 17.1s | /private/tmp/canvas33-generation-rest2/generation-canvas-guidance |
| generation-canvas-history | passed · 13.1s | /private/tmp/canvas33-generation-tail3/generation-canvas-history |
| generation-canvas-images | passed · 12.8s | /private/tmp/canvas33-generation-tail3/generation-canvas-images |
| generation-canvas-journey | passed · 52.1s | /private/tmp/canvas33-generation-rest2/generation-canvas-journey |
| generation-canvas-lifecycle | passed · 9.9s | /private/tmp/canvas33-generation-tail3/generation-canvas-lifecycle |
| generation-canvas-media | passed · 9.1s | /private/tmp/canvas33-generation-tail6/generation-canvas-media |
| generation-canvas-mixed | passed · 8.5s | /private/tmp/canvas33-generation-rest2/generation-canvas-mixed |
| generation-canvas-multi-view | passed · 18.1s | /private/tmp/canvas33-generation-tail6/generation-canvas-multi-view |
| generation-canvas-named-references | passed · 16.6s | /private/tmp/canvas33-generation-tail6/generation-canvas-named-references |
| generation-canvas-narrative | passed · 15.1s | /private/tmp/canvas33-generation-tail6/generation-canvas-narrative |
| generation-canvas-performance | passed · 14.6s | /private/tmp/canvas33-generation-rest2/generation-canvas-performance |
| generation-canvas-photography | passed · 12.3s | /private/tmp/canvas33-generation-tail/generation-canvas-photography |
| generation-canvas-ports | passed · 12.2s | /private/tmp/canvas33-layout-tail/generation-canvas-ports |
| generation-canvas-prewire | passed · 18.3s | /private/tmp/canvas33-generation-final/generation-canvas-prewire |
| generation-canvas-runtime | passed · 11.1s | /private/tmp/canvas33-generation-tail3/generation-canvas-runtime |
| generation-canvas-save | passed · 9.8s | /private/tmp/canvas33-generation-tail6/generation-canvas-save |
| generation-canvas-sessions | passed · 9.3s | /private/tmp/canvas33-layout-rest/generation-canvas-sessions |
| generation-canvas-sound | passed · 11.7s | /private/tmp/canvas33-generation-tail/generation-canvas-sound |
| generation-canvas-spatial | passed · 13.0s | /private/tmp/canvas33-generation-tail6/generation-canvas-spatial |
| generation-canvas-target | passed · 8.1s | /private/tmp/canvas33-generation-tail3/generation-canvas-target |
| generation-canvas-tools | passed · 6.1s | /private/tmp/canvas33-layout-tail/generation-canvas-tools |
| generation-canvas-video | passed · 16.0s | /private/tmp/canvas33-generation-tail3/generation-canvas-video |
| generation-canvas-video-bindings | passed · 13.1s | /private/tmp/canvas33-generation-tail3/generation-canvas-video-bindings |
| generation-canvas-visual-presets | passed · 11.9s | /private/tmp/canvas33-generation-tail/generation-canvas-visual-presets |
| legacy-labs | passed · 35.8s | /private/tmp/canvas33-legacy-final/legacy-labs |

共享工作台复用记录：

| case | 实际结果 | 证据目录 |
| --- | --- | --- |
| workbench-ui | passed · 4.6s | /private/tmp/canvas27-33-workbench-baseline/workbench-ui |
| workbench-style | passed · 69.9s | /private/tmp/canvas27-33-workbench-baseline/workbench-style |
| design-scope | passed · 15.5s | /private/tmp/canvas27-33-workbench-baseline/design-scope |
| unit-design | passed · 29.1s | /private/tmp/canvas27-33-workbench-baseline/unit-design |
| instruction-preparation | passed · 10.1s | /private/tmp/canvas27-33-workbench-baseline/instruction-preparation |
| instruction-design | passed · 16.9s | /private/tmp/canvas27-33-workbench-baseline/instruction-design |

## 检查及限制

- 前端 typecheck、单元检查通过；定向 ESLint 没有新增错误。
- `lint:check` 未通过：Graph 两条 inspectTarget 与 useCardCandidates 一条 entity 的 hooks 依赖告警与实施基线一致，本轮未重建 lint 基线或擅改无关逻辑。
- 共享工作台六项检查复用 `/private/tmp/canvas27-33-workbench-baseline/results.json`，共享工作台实现未改；生成画布的主题与布局改动由本轮真实页面单独验证。
- 公开 HTTP schema 和应用后端未改，无需重新生成 OpenAPI 客户端或运行应用 Pylint。浏览器夹具的外部存储替身改动属于测试接缝，不代表外部存储集成验收。
- MySQL selection 在 `/private/tmp/canvas33-generation-tail2/generation-canvas-selection/run.log` 触发 `parallel browser requires explicit isolated MySQL`；没有配置 JELLYFISH_TEST_MYSQL_URL，页面未执行，不记为通过。


## 失败与复用说明

- 首轮旧入口、旧端点选择器及固定目录计数失败均已按新公开 UI 迁移。完整 Journey 在预检 HTTP 响应与模态挂载间的等待竞态已通过明确等待模态解决，最终 52.1s 通过；Composer 改用真实键盘选择候选，最终 10.2s 通过，不绕过采用边界。
- Graph 将旧“拖到禁用逻辑端点”断言改为新用途菜单不提供不兼容选项、取消后 HTTP 不新增边，保留原配置与候选。分组标题也纳入适应全部范围，Graph 完整旅程 14.6s 通过。
- `legacy-labs` 首次在旧实验室跳转 URL mode 断言偶发失败；主区基线独立重跑 36.2s 通过（`/private/tmp/canvas33-legacy-baseline`），33 最终独立重跑 35.8s 通过（`/private/tmp/canvas33-legacy-final`）。本轮未修改实验室业务或该用例，不隐去首次失败。
- 27–32 各票的自身红绿与验收证据仍保留。33 中上述 39 项均为本轮再次执行，不将前票通过直接充作新组合验收；仅未受影响的共享工作台六项复用。
- 本次两份测试迁移子工作树已经清理，分支及工作树外截图／日志保留；33 主工作树由集成流程最后清理。01–26 内容哈希与实施前逐字节一致。

## 双轴审查修复与定向验证

本轮审查发现的两项规格 P2 和一项规范 P3 已在独立修复分支处理；这里记录修复和验证，不预记审查者复核结论。

- 导演摘要保留主字段优先，主字段无内容时回退到本卡其他明确 DesignField；摄影也覆盖阶段画面及只有结构化景别的字段。摘要最多三项，忽略空状态，不把适用范围、来源或身份等元数据当设计正文；否定、不适用、待确定和提议保留状态语义，不改变完整输出或采用粒度。
- 连接点 Tooltip 同时响应 hover 和 focus；真实 Tab 聚焦显示主要输出，Shift+Tab 离开后消失；拖线期间目标提示仍沿原受控逻辑。
- 清理旧输入／输出端点 DOM 删除后遗留的两条 CSS，无未使用的旧端点选择器。
- 真实红例：`/private/tmp/canvas-review-summary-red2` 为光源有内容而卡面空态；`/private/tmp/canvas-review-summary-green-focus-red` 通过摘要后在键盘焦点提示失败；`/private/tmp/canvas-review-framing-red` 为结构化景别无文本的摘要缺失。首次 `/private/tmp/canvas-review-summary-red` 是测试夹具使用无效锚点字段而被 HTTP 422 拒绝，修正夹具后才作为有效业务红例，不混淆两者。
- 最终新公开页面用例 `generation-canvas-director-summaries` 在 `/private/tmp/canvas-review-director-final` **6.2s passed**；覆盖 21 组非主要字段、阶段／结构化景别、否定与开放状态、元数据排除，以及右侧编辑即时回显、键盘焦点与失焦。桌面焦点提示及窄屏截图已实际查看。

以下受影响回归使用原公开 HTTP＋真实页面入口，供应商与外部存储仍为受控替身，证据统一位于 `/private/tmp/canvas-review-fixes-release/<case>/`：

| case | 实际结果 |
| --- | --- |
| generation-canvas-director-summaries | passed · 5.4s |
| generation-canvas-performance | passed · 14.1s |
| generation-canvas-photography | passed · 12.4s |
| generation-canvas-spatial | passed · 13.0s |
| generation-canvas-narrative | passed · 14.8s |
| generation-canvas-sound | passed · 12.8s |
| generation-canvas-continuity | passed · 14.1s |
| generation-canvas-guidance | passed · 16.2s |
| generation-canvas-visual-presets | passed · 12.0s |
| generation-canvas-ports | passed · 11.5s |
| generation-canvas-accessible-connections | passed · 11.0s |

前端 typecheck、差异检查及 01–26 字节校验通过；定向 ESLint 只有原 Graph 的两条 inspectTarget hooks 告警，无新增错误。没有应用后端或公开接口变更。除摄影结构化景别补充外的十项既有行为回归均不受该局部标签映射影响；最终新增用例再次覆盖该补充。原 39 项画布／旧实验室与 6 项共享工作台证据继续有效，新独立用例加入后共 46 项有通过证据；MySQL selection 未配置和原全局 lint 三条告警限制不变。
