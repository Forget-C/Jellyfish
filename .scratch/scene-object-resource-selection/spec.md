# 对象参考卡片、资源选用与动态生产引用

Status: ready-for-agent
Completion: resolved
Blocked by: None

## Problem Statement

场次创作者目前需要在对象卡片的多个菜单和单图选择入口之间切换，才能复用资源、创建资源或准备参考。卡片信息与操作层级不稳定，长文案容易挤压有限宽度；仅凭名字选择资源也不便核对外观。

更重要的是，场次准备目前提前选择并保存单张图片，分镜画布又据此建立固定图片引用。创作者实际希望复用的是故事对象：为对象选用一个项目资源，在详情中持续完善资料和多角度图片，生产时再取主图或指定角度默认图。提前固定图片会使资源更新、清空和重新选用无法自然作用于后续生产。

资源身份、故事对象身份和一次生产使用的图片必须分开：清空“张三”的资源选用不应删除故事里的“张三”；更换资源不应改写故事名称；已经开始的生产则不能因为资源更新而改变输入。

## Solution

对象卡片保持当前宽度与图片高度，图片下方固定三个内容区域：名称与类型及菜单、单行截断描述、按状态出现的选用与创建操作。用户可以核对同名候选、通过图片搜索选用项目或资产库资源，也可以直接上传或填写设定创建。编辑资料和生成图片统一通过名称进入对应资源详情。

场次对象选用当前项目资源；库中资源先独立导入，项目内资源直接复用。画布中的对象参考通过提取对象身份解析其当前选用的资源，而不是提前固定资源图片。用户用结构化的 `@张三` 引用主图，用 `@张三-左侧` 等引用角度默认图；只有实际图片／视频生产提交时才固定本次使用的文件。

清空仅解除选用，提取对象和画布参考卡保留。重新选用、资源图片更新影响未来动态解析，明确采用的固定图片和已受理任务继续独立。存量采用直接转换与冲突清理，不增加旧场次单图格式兼容逻辑。

## User Stories

1. As a scene creator, I want object cards to retain their current width, so that additional actions do not disrupt the grid.
2. As a scene creator, I want three stable information areas below each image, so that I can scan identity, description, and actions consistently.
3. As a scene creator, I want long descriptions truncated and empty descriptions to retain their height, so that cards remain aligned.
4. As a scene creator using a narrow viewport or enlarged text, I want actions to wrap without truncation, so that every action remains readable and reachable.
5. As a scene creator, I want the current resource main image displayed without an angle selector, so that preparing an object does not require selecting a production image.
6. As a scene creator, I want the card menu limited to description and provenance plus clearing, so that the menu has a focused purpose.
7. As a scene creator, I want to review the full extracted description and provenance, so that I can verify the story context.
8. As a scene creator, I want a same-name shortcut when I have not selected a resource, so that I can quickly reuse a likely match.
9. As a scene creator, I want both project and library same-name candidates shown with images and provenance, so that I can decide which resource is appropriate.
10. As a scene creator, I want same-name matches to require explicit confirmation, so that unrelated resources are not merged or selected automatically.
11. As a scene creator, I want matching failures distinguished from no matches, so that network failures do not mislead my decisions.
12. As a scene creator, I want a searchable image grid with project and library tabs, so that I can recognize resources visually instead of choosing from a text-only list.
13. As a scene creator, I want search, pagination, selection, and image preview to remain separate interactions, so that browsing does not accidentally apply a resource.
14. As a scene creator, I want only resources compatible with the object type and project scope, so that I cannot create invalid references.
15. As a scene creator, I want to reuse an existing project resource directly, so that multiple scenes can benefit from the same maintained resource.
16. As a scene creator, I want a library selection imported as an independent project resource, so that project edits do not change the library original.
17. As a scene creator, I want name conflicts resolved explicitly by choosing an existing resource or renaming a new copy, so that nothing is overwritten silently.
18. As a scene creator, I want to select a project resource that has no images yet, so that I can prepare its images without creating a duplicate resource.
19. As a scene creator, I want library import to require a usable image, so that an image-based copy can actually be created.
20. As a scene creator, I want to upload images directly into a new project resource, so that I do not need an intermediate library asset.
21. As a scene creator, I want drag-and-drop upload with upload status, retry, removal, and view settings, so that I can prepare image-based resources reliably.
22. As a scene creator, I want extracted name and description prefilled when creating from settings, so that I do not need to re-enter the story context.
23. As a scene creator, I want to confirm generation settings before submitting generation, so that creating an object does not silently start a production task.
24. As a scene creator, I want a successfully created resource selected even if its image generation is still pending or fails, so that I can continue working with the saved resource.
25. As a scene creator, I want selection retries to reuse a resource that was already created, so that a partial failure does not create duplicates.
26. As a scene creator, I want “create again” to create a new resource while retaining the old one, so that replacement does not destroy existing work.
27. As a scene creator, I want to enter the selected resource details by clicking the object name, so that editing and generation share the existing resource workflow.
28. As a scene creator, I want an unselected object name to remain plain text, so that clicking it cannot create a resource implicitly.
29. As a scene creator, I want the story object name to remain distinct from the resource name, so that selecting “young man” does not rename the character “Zhang San.”
30. As a scene creator, I want returning from resource details to restore filters, scroll position, and focus, so that I can continue preparing the scene.
31. As a scene creator, I want clearing to require confirmation and retain the extracted object, resource, and images, so that I can reset preparation without deleting creative work.
32. As a scene creator, I want clearing or replacing a selection to affect canvases that still follow that scene object, so that I do not need to edit every canvas manually.
33. As a scene creator, I want reference cards and mentions retained after clearing, so that I can repair missing references without reconstructing the storyboard.
34. As a scene creator, I want active generation to continue on its original resource after clearing or replacement, so that late results do not restore an obsolete selection.
35. As a scene creator, I want resource deletion, missing images, and image loading failures distinguished, so that I can take the correct recovery action.
36. As a scene creator with read-only access, I want to inspect descriptions, previews, and details while mutations are disabled, so that I can review safely.
37. As a canvas author, I want storyboard planning to use story text and object identities without requiring resource images, so that image preparation does not block text planning unnecessarily.
38. As a canvas author, I want references to follow the scene object identity rather than a copied resource selection, so that later scene selection changes are visible to future production.
39. As a canvas author, I want `@张三` to use the current main image, so that the default reference remains simple.
40. As a canvas author, I want `@张三-正面` and other supported angles to use their current default images, so that an explicit angle is different from an unspecified main image.
41. As a canvas author, I want mention candidates with previews and clear identity information, so that I can choose among similar or identical names.
42. As a canvas author, I want only confirmed mention candidates to create structured references, so that typed text or names containing hyphens cannot bind to the wrong object.
43. As a canvas author, I want stable identities behind mention labels, so that renaming does not break references.
44. As a canvas author, I want to retain the existing option to reference a specific image, so that a deliberate fixed choice does not follow later default changes.
45. As a canvas author, I want to reference multiple angles of one object in a prompt, so that I can provide complementary views without creating multiple character identities.
46. As a canvas author, I want model input limits reported explicitly, so that extra views are not silently discarded.
47. As a canvas author, I want missing required images to block submission without substituting another view, so that the production inputs match my request.
48. As a production operator, I want each accepted image or video task to retain the concrete files it resolved at submission, so that execution and historical review do not drift after resource edits.
49. As a production operator, I want future submissions to resolve updated resource defaults without rewriting canvas references, so that resource maintenance is effective immediately for new work.
50. As a project maintainer, I want resource deletion to invalidate dynamic references without deleting story objects or protected historical files, so that identity and file retention are handled separately.
51. As a project maintainer, I want unambiguous old selections converted directly and conflicting data identified for cleanup, so that obsolete scene single-image behavior does not require permanent compatibility code.
52. As a project maintainer, I want independently uploaded scene images incorporated into their verified resource where possible, so that useful images are not lost when single-image preparation is retired.
53. As a project maintainer, I want an exact cleanup impact list before changes to real data, so that removing conflicts does not expand into unintended canvas, task, resource, or file deletion.
54. As a project maintainer, I want valid fixed-image references and accepted task inputs preserved, so that simplification does not remove an existing supported capability.

## Implementation Decisions

### 范围、模块与身份

1. 修改场次对象准备的卡片与状态、项目资源选用与创建入口、对象级引用契约、分镜画布组装、引用候选与标签、实际媒体任务输入解析及对应保护。复用现有资源编辑器、图片选择网格、上传表单和结构化提示词编辑器，不建立第二套平行业务流程。
2. 本次对象范围为人物、场所、道具。人物对应项目角色和库中演员；场所与道具同类映射。项目候选限定当前项目，不引入项目演员、服装或其他项目候选。
3. 项目资源直接复用；资产库选用先独立导入，复制全部有效成员图片与主图／角度默认选择，不复制设定、长期参考、任务或候选。不为每张提取卡片重复复制项目内资源。
4. 提取对象、项目资源、具体图片分别拥有稳定身份。提取名称、描述、出处不被选用资源的信息覆盖。名称入口打开实际资源详情，标题明确实际资源名称；画布派生引用保持故事对象名称。
5. 权威引用关系为“画布对象参考 → 提取对象身份 → 当前选用的项目资源身份”。不能将场次创建画布时的资源 ID 直接复制成长期绑定，否则清空场次对象不会作用于画布。引用身份须在所属项目及场次范围内验证，不能根据显示名称恢复或猜测归属。

### 卡片与操作

6. 保持最小 228px 卡宽、现有自适应网格、160px 图片高度和完整比例预览。内容留白桌面 16px、手机 12px，区域间距 8px。卡面预览资源当前主图，删除角度 Select。
7. 第一区域保留名称、类型及右侧菜单。有效选用时名称可进入详情；未选用时名称为普通文字。菜单仅保留“描述与出处”和适用的“清空”，不增加查看库中资源或解除关联入口。
8. 第二区域展示提取描述，单行省略、固定 20px 高；空描述显示“未填写描述”。完整描述和出处在阅读弹窗中展示，不用资源描述替换提取描述。
9. 第三区域为操作区。无选用且有同名候选时显示“选用同名／选用／创建”；无同名时显示“选用／创建”；已选用或原选用失效时显示“重新选用／重新创建”。已选用但无图属于已选用状态。
10. 有 A 时突出“选用同名”，否则突出创建，选用保持次级。按钮间距 8px，正常宽度同排；极窄或放大字体时操作区内部换行、同一网格行底部对齐。三行指三个内容区域，不强迫三条物理文字行；不缩字号、不截断动作、不扩卡宽、不横向滚动。
11. 同名查询只查同类与授权范围，沿用服务端名称规则。待查询和查询失败不得当成无同名；首载保持尺寸，失败可重试，后台刷新保留已有内容。

### 选用与创建

12. 同名快捷入口打开 Modal，展示图片、名称、来源、描述与效果；两边都有同名时共同呈现、项目排前，须明确选择。项目确认文案为“确认选用”，库中为“导入并选用”。不自动选择或合并同名资源。
13. 通用选用复用图片选择样式，提供项目资源／资产库切换、默认项目、名称或描述搜索、分页、选中态和成员图片预览。候选选择与预览分离，明确提交才应用；不在此流程选择本场固定单图。
14. 无图项目资源可选用，也可进入同名候选；图片来源导入仍需至少一张有效图。导入与项目名称冲突时，改副本名或返回选用已有对象，不覆盖。弹窗内说明重新选用影响动态参考，保留原资源、固定图片引用及已受理任务。
15. 创建入口提供上传和填写设定并生成。上传复用 Dragger、受控图片列表、进度、失败重试、移除、主图与视角能力，直接创建本项目对应资源，不先写资产库。项目直接上传是新增业务能力，本轮仅增加对象参考入口，不同步扩大项目资源列表入口。
16. 填写设定复用对应资源编辑内容，预填提取名称、描述；保存和生成配置继续由用户明确提交。既有详情权限、草稿保护与图片管理沿用相应资源规则，不因本次入口改变而隐式覆盖事实。
17. 重新创建代表新资源，不是对旧资源再次生成。原资源保留，名称冲突须调整。新资源保存成功即完成选用；图片任务排队或失败不回滚资源与选用。资源已建但选用失败时重试原身份，不再次创建；创建请求沿用幂等与并发冲突保护。
18. 编辑和生成通过名称进入对应详情，返回恢复筛选、滚动与焦点。只读仍可阅读和预览，写操作禁用。提交期间锁定该卡片冲突动作；后台图片任务运行不阻止清空或重新选用，迟到结果不能恢复旧选用。

### 清空与删除

19. 清空前二次确认：解除本场选用及仍沿用它的动态参考，保留提取名称、描述、出处、资源和图片。对象参考页不删除提取对象。清空后画布对象卡和正文引用保留，显示无选用或暂无参考图。
20. 资源删除可使动态引用失效，不因存在动态引用而一概阻止删除；不连带删除提取对象或画布卡片，不自动选同名替代。项目资源、图片加载、图片成员可用性分别表达。资源级删除与文件保护分开，任务、固定图片引用及历史所需文件继续保留；不改变本次之外的删除规则。
21. 主图和角度默认图的变更与删除沿用现有默认图维护规则。后续解析查询当前默认值，无图明确失败。资源改名不改写故事名称或破坏身份引用。

### 实际生产与 @ 引用

22. 场次准备保存对象选用关系，列表仅按需读取主图及可用状态；无须读取或固定完整图片集合。当前分镜文字规划模型只消费原文与对象文字信息，不需要资源图片。本次取消仅为初始化固定图片内容卡而提前冻结资源图的要求，新画布保留对象级来源。
23. 动态引用使用主图或受支持的角度选择器。实际图片／视频生成提交时解析当前有效图片，校验权限、文件状态及模型能力，受理时记录并保护本次真正使用的文件。任务执行、对同一固定输入的重试和历史核对不再次跟随资源更新；新生产提交重新解析当前值。
24. 缺主图、缺指定角度图或来源失效时，不回退任意图片或其他角度。必需参考未满足时拒绝提交；已有允许无参考的场景须由用户明确按无参考继续。
25. `@张三` 展示主图引用，`@张三-正面`、`@张三-左侧` 等展示角度引用。主图与正面默认图可能不同。复用现有候选列表，显示缩略图、角度和消歧信息；只从资源受支持的角度中选择，不将自由角度描述解释成枚举，不根据提示词猜测角度。
26. 文字输入仅筛选候选，明确选择后才建立结构化引用。内部保存稳定对象身份及选择器，不拆分连字符解析身份。未确认文字仍是文本。同名、真实名称含角度后缀或特殊符号、改名均不能错绑；标签由故事对象身份生成。
27. 具体单图沿用现有固定图片引用能力。它与动态对象方式保持明确区分，不另造编号语法；资源图更新、清空和重新选用不得覆盖独立固定图片选择。
28. 同一对象可同时引用主图与多个角度，引用去重必须保留选择器区别和同一对象身份，不能仅按资源 ID 合并，也不能拆成多个角色。解析为相同文件时可复用媒体输入，保留全部文字引用；超出模型能力明确报错，不静默丢图。图片集合是候选，不整体发送给模型。
29. 涉及契约包括场次对象读写、同名候选与选用、项目直接上传、画布对象来源与引用候选、实际生产解析及任务输入。前后端权威契约同步；实现时按当前数据模型选择最小必要的结构与迁移，不预先指定未经核实的表结构。资源 ID、提取对象 ID、视角和具体文件身份必须表达清楚。

### 存量转换与清理

30. 有效旧资源选用直接转为对象级关系，取消场次层固定单图。资源成员图片保留；独立场次上传能明确归属时并入所选项目资源，不覆盖已有主图或角度默认图，其他使用该资源的位置可将其作为候选。
31. 不新增旧场次单图格式的兼容分支。不能直接转换的冲突项可以移除，不按同名猜归属；在实施阶段列出精确记录、依赖、文件保护变化和风险，经相应范围确认后执行，不将方案批准当作无界删除授权。
32. 已有正常固定图片引用和任务输入是受支持能力，不是待清理冲突。已有画布不自动改成动态对象引用；需要时由用户明确更换来源。仅解除确认已无用途的场次单图保护，任务、画布及历史保护保留。

## Testing Decisions

测试边界已由用户确认：采用下述两个主要边界，优先复用现有入口与夹具，不为每个内部模块新建独立测试边界。良好测试验证请求与页面操作产生的外部可观察结果，不绑定函数拆分、内部调用次数或组件实现结构。

### 边界一：公开 API＋真实任务流程

- 使用隔离数据库与文件存储，经公开接口创建资源、选用场次对象、构建画布、提交任务并读取结果；保留真实存储、任务生命周期、资源校验及文件保护，只替代外部模型调用。
- 沿用场次对象和分镜真实任务测试先例：受控文本模型返回候选，真实 Worker 执行，验证来源、身份、修订和失败恢复。
- 沿用图片来源资源 API 测试先例：类型与项目权限、复制隔离、无有效图、同名冲突、上传、复制失败回滚、重复请求与创建后恢复。
- 沿用画布命名参考和保存测试先例：固定图片来源、对象身份、多角度及媒体输入映射、文件撤回和保护。
- 覆盖三类对象与两种来源；项目复用不复制、库中导入独立；不接受错误类别或其他项目资源；无图项目可选用、无图库导入拒绝。
- 验证清空、重新选用及资源删除后的动态解析、故事身份保留、无同名猜测替代；多张派生画布无需重写绑定即可读取当前选用。
- 验证主图与角度默认图更新影响下一次新生产；受理后的任务仍使用原文件；明确固定图片不跟随变化；必需缺图阻止提交。
- 验证分镜文字任务不传图、不为资源集合注册无用固定输入；实际媒体任务仅记录真实采用文件，排队、运行、重试和历史输入一致。
- 验证多角度同对象、同文件复用、模型限制、未确认文字、连字符与同名消歧、资源改名不改故事身份。
- 存量转换与冲突清理仅先使用隔离数据：核对保留资源、提取对象、合法画布和历史文件，验证清单内外的依赖与保护变化。不默认操作实际库，也不调用真实付费供应商。

### 边界二：真实页面浏览器交互

- 复用工作台对象管理、图片来源创建、资源详情与分镜参考浏览器用例及其既有受控接口；通过真实控件操作验证，不直接改组件内部状态。
- 验证三行区域、空描述占高、长文截断、现有最小卡宽、窄屏与放大字体换行、主图展示、角度 Select 移除及菜单精简。
- 验证无选用／已选用／无图／失效状态的动作矩阵，同名双来源、查询中与失败、图网格搜索分页、预览与选择独立、取消与确认。
- 验证上传和填写设定入口、失败重试、不重复创建、详情编辑生成、返回状态恢复、清空确认及只读限制。
- 验证 `@` 候选键盘选择、缩略图、主图／角度标签、多角度、缺图候选及错误定位；选择具体图片继续保持原体验。
- 验证名称未选用时不隐式创建，故事对象与实际资源名称各自显示，清空后引用仍可识别，迟到任务不恢复旧选用。
- 检查 Tab 焦点、Escape、弹窗焦点恢复、可访问名称、支持主题下的状态辨识以及无横向溢出；仅在受影响共享样式或组件范围扩展覆盖。

实施完成时按项目规范执行前端类型检查、受影响浏览器与后端测试、后端适用静态检查和接口生成同步；同一代码环境下已通过的检查可复用。本文发布仅完成规格与源检查，不表示上述功能测试已经执行。

## Out of Scope

- 增加服装提取对象、项目演员候选或跨项目资源选用。
- 扩展项目资源列表的直接上传入口；本轮新增入口限定对象参考流程。
- 重做资产库卡片、项目资源卡片、整个画布布局或建立新设计系统。
- 将图片集合整体发给模型、让分镜文字规划读取资源图片，或从自由文字自动猜测引用身份及角度。
- 在场次对象卡恢复单图选择或角度 Select；为每个场次重复复制项目资源。
- 自动覆盖或合并同名资源，复制资源设定／长期参考／任务，或维持库中原件的共享编辑关系。
- 给旧场次单图格式新增兼容逻辑；将正常固定图片能力当作遗留冲突删除。
- 自动重写已有画布固定图片、历史任务及已受理生产输入。
- 未经具体影响核实和范围确认的实际数据删除、文件清理或额外迁移。
- 在本规格发布阶段拆分实现票据、开始实现、运行实际库清理或创建提交。

## Further Notes

- 发布日期：2026-11-16。需求与两个测试边界均已确认，状态为 `ready-for-agent`；此状态不代表已实现或已验收。
- 项目任务系统为本地 Markdown，本文件即规格发布结果，无外部 issue 服务发布步骤。
- 最终决定以“画布 → 提取对象 → 当前项目资源 → 本次生产用图”为准。较早讨论中的“分镜任务固定整套图片”“画布直接复制资源 ID”“清空不影响动态画布”“动态引用一律阻止资源删除”已被替代，不可重新引入。
- 产品设计：[对象参考卡片与资源选用设计](../../docs/development/design/scene-object-resource-selection.md)。
- 领域词汇：[术语表](../../GLOSSARY.md)。
- 归属与项目上传：[图片来源资源与独立项目导入](../../docs/development/adr/0008-image-source-resources-and-project-imports.md)。
- 引用决策：[场次对象身份引用与生产用图分离](../../docs/development/adr/0009-scene-object-resource-references.md)。
- 技能边界：本轮仅整理和发布规格；后续实施及存量清理按用户相应授权与精确影响范围执行。

## Comments

六张实施票据及本次实际存量转换均已完成。集成分支 `codex-scene-object-resource-selection`，具体检查与实际库转换证据见 [集成验收](acceptance.md)。
