# 04: 类型化连线、分组与模型卡配置

Status: ready-for-agent
Completion: complete
Blocked by: 01

**What to build:** 用户创建三类模型卡，选择模型、查看类型参数，并用兼容端口和分组组织可保存的画布。

**依据：** [实现规格](../spec.md)；[任务依赖与共同验证](../README.md)。验收覆盖：A06、A15。

## Acceptance criteria

- [x] 轻量 CardDefinition 扩展三类模型卡及四类内容卡的端口、配置、校验与编译入口；模型能力独立描述，不按供应商复制卡类型。
- [x] 前端通过明确 rendererRegistry、CardShell 和类型参数组件展示；复用共享 Composer 外壳，参考区／正文／底部参数区职责清晰。
- [x] 拖线突出兼容端口，目标端口决定用途；相同来源端口到相同目标端口不重复建线，不支持输入不给隐式转换。
- [x] 拒绝自连、循环和损坏端点；每目标端口输入顺序独立保存，新连接追加，卡片移动不重排输入。
- [x] 分组支持命名、移动、折叠，成员独立；解散组保留卡片，不提供集合输出。
- [x] 切换模型保留配置和连接并显示能力差异，不完整配置可保存；无效生成参数提供诊断。按实际引用决定输入是否阻塞的完整验收归 05，本票不依赖尚未交付的引用编辑器。
- [x] 参数选项以真实接入能力为准；视频仅开放模型、画幅、时长和高级随机种子，未接入多模态文本能力不得虚报。

## Validation

- 真实文档保存回读验证端点、顺序、分组与模型配置；图结构异常有定位诊断。
- 浏览器验证拖线拒绝原因、输入排序、移动／折叠不变更输入、模型切换保留现场。
- 能力测试检查声明与现有 DTO／Adapter 一致，不用界面样例中的模型名推断能力。
- 执行 [共同检查要求](../README.md#共同检查要求) 中适用于本票变更的命令，并记录真实结果。

## Scope and handoff

提供候选连接、顺序、类型契约与受控 Composer 参数区。05 实现结构化引用并使实际使用判断完整；06、08、09 分别接通生成，不创建空壳运行成功状态。

## Comments

- 2026-10-23：依据已确认术语和 ADR 建立实现票据，尚未开始实现或执行验收。


- 2026-10-23：实现完成。后端具体卡类型／类型参数、端口、候选边、每端口输入顺序与独立分组通过完整文档持久化；图结构错误提供稳定代号及卡／边／端口定位。模型能力从真实 DTO 和 image/video resolver 派生，文本不虚报多模态。模型切换保留配置及候选，未保存候选也不要求先单独保存；同模型新增不兼容候选拒绝，完整实际使用诊断接续 05。
- 2026-10-23：前端明确 rendererRegistry、CardShell、按模态参数组件，直接复用受控 ExperimentComposer；真实端口指针拖动、兼容高亮／拒绝原因、去重、自连和循环规则，分组命名／移动／折叠／独立成员／解散保留卡片。四类内容卡注册 03 真实编辑器，按画布／卡身份卸载异步上传，迟到回调只更新仍存在的卡。
- 2026-10-23：TDD red：HTTP 图文档起初因不支持 model.text 返回 INVALID_DOCUMENT，损坏端点／自连／循环／顺序／分组起初全部错误保存成功；真实浏览器模型切换暴露未单独保存候选被误拒绝，补齐保存规则后 green。`pytest tests/test_generation_canvas_api.py tests/test_generation_canvas_parameters.py -k 'not mysql' -q` 26 PASS，覆盖保存回读与定位结构错误、能力声明、模型切换、无效参数保留及媒体引用基础；此票未修改事务模型，不以 SQLite 声称 MySQL 并发。
- 2026-10-23：`node front/tests/run-browser.mjs generation-canvas-graph --output /private/tmp/jellyfish-generation-canvas-evidence/04/typed-graph-final` PASS（12.9s），真实浏览器验证端口拖线、重复／自连／不匹配用途拒绝、输入重排、分组移动／折叠／解散、模型切换保留正文／参数／连接并展示能力差异、位置／尺寸／视角刷新恢复及布局期间无内容 PUT。桌面、窄屏与模型切换截图在该证据目录；测试注册独占 4274／8274，不借用主后端。
- 2026-10-23：最终补充验证：`pnpm --dir front run typecheck` PASS；`cd backend && uv run pylint app` 10.00/10。真实图卡壳接入后 `generation-canvas-media` PASS（6.0s），证据 `/private/tmp/jellyfish-generation-canvas-evidence/04/media-regression`。自查补齐“新浏览器无布局缓存打开折叠组”回归，隐藏成员使用默认几何占位以免等待不存在的 DOM 测量，完整 `generation-canvas-graph` 再次 PASS（13.4s），证据 `/private/tmp/jellyfish-generation-canvas-evidence/04/typed-graph-fresh`。已人工查看桌面／窄屏截图；本画布保持项目浅色主题，复用低层 Canvas 和原 Composer，不引入场次暗色主题或场次实体。
- 2026-10-23：最终集成追查修复生产异常封套：新增窄化 `CanvasDomainError`，真实 `app.main.app` 的统一 handler 为画布错误返回标准 `ApiResponse`，`data` 保留稳定 code／target／blocks；其他异常仍为原有 `data=null`。`CanvasError` OpenAPI 与编辑器错误展示同步，绝不反解析 message。TDD red 原 handler 将诊断转为字符串且丢 data；green 使用真实主应用 ASGI + 隔离数据库发起图结构失败、409 与普通 404 验证，相关后端 27 PASS，Pylint 10.00/10，typecheck PASS。`generation-canvas-save` 真实浏览器回归 PASS（12.8s），证据 `/private/tmp/jellyfish-generation-canvas-evidence/04/diagnostic-save-regression`。
