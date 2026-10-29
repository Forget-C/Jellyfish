# C「焦点编辑」组合验收

日期：2026-10-29。基线为已集成49–53的 `caaf154c`；本记录只描述54实际执行与仍有效的局部证据，不改写01–48的完成记录。实现已集成并完成最终双轴定向复核；原始证据和限制继续保留。

## 组合发现与修复

1. **素材管理遮挡标题关闭。** 多已采用来源时，旧280px绝对高度越过正文，覆盖关闭按钮。公开页面命中检查红例见 `/private/tmp/c54-close-populated-red`；修复将候选面板上限绑定到同一编辑器正文的真实高度，保留标题与固定底栏。空态及多已采用面板均通过真实点击关闭／重开，完整material旅程15.3s：`/private/tmp/c54-close-green`。不是仅在测试中先收面板绕过遮挡。
2. **同秒运行快照乱序。** 原快照使用秒级创建时间＋随机UUID，连续运行重开可能取旧节点。HTTP红例固定数据库时钟精度并令UUID逆序，见 `/private/tmp/c54-order-red.log`。现在用现有事件头游标记录内部受理顺序，放入节点私有执行快照，不参与生成依据／哈希／供应商输入、不改变公开DTO。HTTP验证同秒逆序及事件全部裁剪后仍按受理排序；旧运行无元数据时从保留事件恢复。新回归移除了卡底旅程的1.1秒规避等待。
3. **旧测试默认展开所有区域。** C的素材管理是局部覆盖层，旧helper先打开它再点击正文内结果／指令会被遮挡。helper改为先展开正文内按需区域，再打开候选；完整Journey保留所有业务断言。提交位置断言改为整个编辑面（参数已移出滚动正文），仍验证首开不滚动即可见。

## C01–C08覆盖矩阵

| ID | 结果与行为证据 | 图片及复用边界 |
| --- | --- | --- |
| C01 | 通过。49文本、50图片公开HTTP／页面局部证据保持；54完整Journey含切换、展开、生成、历史、另存与重开，当前模型范围不扩大。 | 49 `/private/tmp/c49-native-final`；50 `/private/tmp/c50-evidence/final`；54 `/private/tmp/c54-journey2`。已实际查看基础文本空态、基础图片信息与C模型图。 |
| C02 | 通过。基础文本正文／占位、无图上传／选择、加载／替换失败／只读沿49/50有效检查；51三模态空正文含实际禁用与占位，54material完整回归。 | material-empty、50 image-empty/uploading/replacement-failed、49 text-empty-c；没有隐藏输入获得假空白，元信息来自真实文件／加载。 |
| C03 | 通过。素材栏小图／名称／用途与独立取消；多来源、长名、长文及参数局部横向滚动可用，固定提交不挤走；HTTP核对明确取消仅删除所选绑定。 | `/private/tmp/c54-close-green` material-adopted-detail/mobile/large；`/private/tmp/c54-states` 长文／多来源。 |
| C04 | 通过。模型素材、正文、全宽底栏同一表面，无贯穿横竖分隔线；桌面/窄屏同会话保留。 | 实际查看C最终参考 `design-references/c-focus-desktop.png`，及Journey三视口原图/编辑区裁图，不以尺寸断言替代看图。 |
| C05 | 通过。52公开edge-management13.1s、accessible10.9s含鼠标/键盘/触摸、当前线保护、多用途、只读、焦点恢复；本票未改线逻辑或视觉。 | `/private/tmp/c52-integrated-release`及52票证据；已实际查看purposes-selected，线上小剪刀/按需提示，无整条路径矩形外框。用户剪刀原图为直接参考。 |
| C06 | 通过。取消／采用计数、真实成功→失败保留正式成果、只读、状态说明、重开。53原1.1秒分隔已删除，54无等待旅程通过；HTTP同秒测试使排序可重复。 | `/private/tmp/c54-status-no-delay` 10.7s及后续失效扩展；失败与旧成果的正式输出HTTP相等，不将候选算采用。 |
| C07 | 通过。material首开与展开、states长文/加载/失败/只读；新增来源失效：依据栏role alert显示“依据已变”，预检确认禁用，HTTP运行数不增加、上下游均不自动补跑。 | `/private/tmp/c54-states`9.6s、`/private/tmp/c54-status-final`；`/private/tmp/c54-sessions`10.2s核对保存前后、迟到响应、引用与同会话。 |
| C08 | 通过。完整Journey63.0s，1440×960、390×844、3830×1688输出整页及原尺寸区域；摄影卡、运镜与光影Modal、编组、来源与单模型运行未退化。 | `/private/tmp/c54-journey2/generation-canvas-journey/`下b-canvas/b-composer/b-photography三视口图；文件名沿用既有旅程，当前内容按C验证。摄影/编组仍以B为目标。 |

## 图片对照与明确差异

- C原型以用户参考照片演示；正式验收使用合法原创几何街道示意和受控生成色块，不复制照片为项目资产、不承诺真实模型质量。此差异只影响素材内容，不替代布局核对。
- 桌面正式编辑面约700px、依据约1/4、正文约3/4；全宽单行参数与固定圆形提交保留。真实支持模型／参数替代原型16:9／2K示例；不开放的项仍显示原能力状态，不引入品牌／计费。
- 多来源使用局部滚动；长名省略但来源完整内容可查看，已采用顺序与用途仍可核对。正式编辑保留按需“引用与指令”“运行状态与正式输出”，不常驻完整诊断表。
- 窄屏仍保留既有添加卡片／连接入口，与原型调试界面不同；依据在上、正文在下，标题/关闭及参数/提交可达，不隐藏业务信息换取简洁。
- 摄影Modal仍为B大预览／选择／关键设置，编组为外框＋框外名称；不因C模型局部方案恢复整体C或改摄影布局。
- 实际查看了Journey1440全页、1440／390／3830模型原尺寸图、摄影Modal、素材面板修复图、来源失效图，以及49文本空态、50图片文件信息和52线旁剪刀图。不是仅提供缩小联系图或几何测量。

## 检查与限制

- 实际执行：Node24 typecheck、修改组件定向ESLint、`git diff --check`通过。后端runtime/DAG相关 **19 passed、13 skipped**（`/private/tmp/c54-runtime-legacy-release.log`）；跳过为未配置的独立MySQL项，不用SQLite冒充生产竞争验证。`uv run pylint app` **10.00/10**，最终日志 `/private/tmp/c54-pylint-final.log`。
- 本票公开浏览器：material15.3s、Journey63.0s、states9.6s、sessions10.2s、卡底无delay10.7s及含来源失效最终旅程，均使用真实页面、公开HTTP与受控供应商/存储；最终含失效状态旅程11.5s通过，见 `/private/tmp/c54-status-final`。
- root集成基线上的共享workbench六项全部通过：ui4.5s、style72.7s、design-scope15.6s、unit-design29.8s、instruction-preparation10.5s、instruction-design17.9s，证据 `/Users/extreme/Projects/github.com/jellyfish/front/test-results/browser-sPbyju`。本票仅模型专属浮层限高与后台顺序，不重跑不受影响共享suite；root前端unit已通过，按父代理实际结果复用。
- root全量lint未通过，存量173 errors/104 warnings；lint:check仍报告两条既有hooks依赖警告（Graph inspectTarget及useCardCandidates entity），本票不改其代码、不放宽基线。定向新增代码检查不能被表述为全量lint全绿。
- 无公开schema／接口变化，不机械再生generated client；后端运行顺序仅内部元数据，已同步当前架构说明。旧运行若元数据和事件都不存在，不能恢复同秒真实先后，只保留旧时间／ID回退；不声称精确修复不可恢复的历史。
- 01–48票据与旧验收55文件校验值不变。未调用付费模型，未推送、未创建PR；最终双轴审查由集成流程继续完成。


### 2026-10-29：最终审查统一修复

- Spec P2“素材层Escape跳过内层”：公开material红例在普通编辑中打开素材后按Escape，外层直接隐藏，见 `/private/tmp/c-review-escape-red`。宿主已有按键栈先尊重原生菜单／combobox，再关闭打开的素材层并将焦点交回入口；再次Escape才执行原外层退出／收起。
- 公开material最终15.3s通过（`/private/tmp/c-review-escape-green2`），覆盖普通与展开编辑：第一次Escape仅收素材、焦点回入口、正文保留；再次退出／收起。模型Select的ArrowDown→Escape不关闭素材或外层。既有HTTP采用、生成、重开、三视口断言全部保留；实际查看 `material-escape-expanded.png`，输入与统一表面保持。
- Node24 typecheck、定向CanvasCardEditor ESLint与差异检查通过；无后端或接口变化，复用相关既有检查，不宣称重跑全部后端。01–48与原验收不改写。
- Standards P3仅为同步合并提交标题。已拟定精确脚本 `/private/tmp/c-focus-implementation/fix-merge-message.py`，待集成此修复后由主代理执行；脚本备份原tip、仅改56b2364c消息并验证所有树与其余消息及55历史文件不变。此处不提前记为已完成历史修正或独立复核通过。

## 最终审查与交付

- Standards原1项P3（合并提交标题）已更正；Spec原1项P2（素材Escape未优先）已由统一修复代理红绿处理。两位原审查者独立定向复核，剩余均0；未冒称重复执行全部浏览器／后端用例。报告及复核：`/private/tmp/c-focus-implementation/review-standards.md`、`review-spec.md`。
- 提交消息修正前后产品树相同，原tip保留备份，20条本轮提交全部格式合规；最终产品头 `cdac0fff`，精确审计 `/private/tmp/c-focus-implementation/merge-message-fix-audit.json`。纯消息调整不重复运行相同代码的已绿检查。
- 01–48及旧验收55文件校验值不变。7个本轮实施／统一修复工作树在确认干净与产品树可追溯后清理，原型保留；清理审计见 `/private/tmp/c-focus-implementation/cleanup-audit.json`。上述lint、MySQL条件、历史排序及受控外部服务限制不因审查清零消失。
