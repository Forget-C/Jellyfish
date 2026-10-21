# 共享 graph 改造代码审查

固定基线：`d264de4738484306d5b1b17ad588803546d31ac6`。
首次实现提交：`06f79c1b7ca6b38798d39401517d91bb82c4cb4a`。
审查命令：`git diff d264de4738484306d5b1b17ad588803546d31ac6...HEAD`，首次审查时 HEAD 即上述提交。

按 code-review 技能由独立 Standards／Spec 审查者并行执行，以下分轴保留结果，不合并或跨轴排序。最终代码修复和复查已完成；历史报告保留，最终结论见末节。

## Standards

已确认 HEAD 为 `06f79c1b7ca6b38798d39401517d91bb82c4cb4a`。

硬规则发现：

- **[P2] 根视图仍依赖固定地址 `scene`** — `front/src/pages/aiStudio/directing/SceneUnitCanvas.tsx:45`、`DirectorDesignCanvas.tsx:47`、`directorCanvasGraph.ts:30`，以及 `UnitGraphCanvas.tsx:34,44,117`。新契约允许任意视图 ID，但这些消费者拒绝不叫 `scene` 的合法根视图，并在导航中继续写入该固定地址。违反 `site/content/docs/guide/canvas-graph.md` 后端步骤 4「节点 ID、视图 ID 对消费者是不透明地址」及前端「使用返回的视图和定位地址导航」。建议按 `parent_id == null` 获取根视图，复用其返回地址；补根视图重命名验证。当前子图不透明 ID 测试不足以覆盖此处。

- **[P3] 新编辑入口绕过共享按钮** — `front/src/pages/aiStudio/directing/SceneUnitCanvas.tsx:261` 新增“查看单元设置”入口直接使用 AntD `Button`，同区域建立单元入口却使用 `WorkbenchButton`。违反 `site/content/docs/guide/workbench-design.md`「新增或修改这些区域时，先使用现有共享组件」及动作颜色、高度由共享 tokens/CSS 决定的规则；未找到对应例外记录。改为 `WorkbenchButton`，明确使用次动作样式。

判断性 smells：结合所给全部 baseline 检查后，没有足够明确、值得单列的新增问题。共享构建器、读取上下文和图组件均已有真实复用点，不属于 Speculative Generality。

## Spec

确认 HEAD 为 `06f79c1b7ca6b38798d39401517d91bb82c4cb4a`，仅审查固定基线 diff。发现两项规格缺口：

1. **[P1] 新增导演对象关闭详情后，保存前无法重新编辑。** 规格 `spec.md:191–192` 要求“保存前、保存失败后及关闭详情后，仍可重新进入当前对象继续编辑”，且不得强制保存。`front/src/pages/aiStudio/directing/directorCanvasGraph.ts:11–23` 的编辑对象全集仅来自已保存 graph；`DirectorDesignCanvas.tsx:365–367` 的定位菜单也只使用这些对象。可直接触发：在空设计中“添加首个镜头”，关闭详情并令保存失败；新镜头不在 graph 中，新增按钮又因当前内容已有镜头消失。附加信息的镜头按钮只进入空子图，无法重新打开该镜头编辑器。应提供读取当前编辑内容的明确选择／编辑入口，无需创建临时图节点。

2. **[P2] 新增单元保存前无法绑定参考素材。** 同一规格 `spec.md:191–192` 以及 A16 要求未保存对象仍能继续编辑。`front/src/pages/aiStudio/directing/SceneUnitCanvas.tsx:242–244` 只有 graph 中参考卡的回调能打开 `ReferencePicker`；新增单元的独立入口 `:258–261` 仅能打开设置，而设置没有参考编辑入口。新增单元尚未保存或保存失败时，服务端 graph 不含该单元，因此无法添加任何参考，必须先保存成功。应在当前单元编辑入口或设置详情提供同一参考编辑动作。

Standards：2 项，最高为 P2 根视图地址；Spec：2 项，最高为 P1 未保存导演对象的编辑可达性。

## 修复与复查

待补上述四项。所有结项标记保留到修复、受影响验证及复查完成后。

2026-10-21 修复进展：

- Standards P3：当前单元“查看单元设置”改为 WorkbenchButton secondary；新增的参考入口同样使用共享按钮。typecheck 与完整 graph 浏览器通过，并检查 390px 截图无按钮越界或重叠。
- Spec P2：当前单元编辑入口新增“编辑当前单元参考”，直接复用同一个 ReferencePicker 和现有 onApply／保存队列，不依赖该单元已在 graph 中。新浏览器先因缺少入口失败（vQZjKH），修复后实际上传、绑定、首次保存失败、关闭恢复与撤销旧图入口完整通过（LBdClK）。
- Standards P2：根视图及导演／单元子图地址均消费后端值；契约明确且校验唯一根，OpenAPI 同步。公开契约 26 passed、directing 503 passed，完整 graph 浏览器 WxCIl6 通过任意根／子图 ID。
- Spec P1：附加信息提供当前未同步对象编辑入口，不组装临时 graph。空版本首镜头输入、关闭、422 后重开通过，服务端仍无镜头（WxCIl6）。
- 额外自审：真实全场锚点的详情还通过旧前端连通性推断镜头关系；6JN77V 复现，改为消费后端归属及路径后 gYn88w 完整浏览器通过。旧函数的独立调用行为未用于已迁移详情。
- 四项初始发现已修复，等待固定修复提交后的两轴复查；尚未最终结项。

## a3ad716 复查

### Standards

已核实 HEAD 为 a3ad7164479d74fd1c71eac6f586fc59588e65d9。硬规则通过，无新增发现；原 P2 根／子图地址和 P3 共享按钮均已修复。待同步对象入口只选择当前编辑对象，详情 supplied relationshipGraph 使用服务端关系证据。全部 12 项 smell baseline 无值得单列的新发现。本轴只读审查，未独立重跑测试。

### Spec

原 P1 导演对象重进与 P2 新单元参考已修复；另发现 P1：重复的无 ID 历史设计行编辑后，旧快照可唯一匹配另一行，导致旧卡错绑。违反 spec.md:191、193 的当前对象重进与不得错绑要求。directorCanvasGraph.ts:15–20 先 resolveTarget 再判断列表未变，不足以阻止重复旧快照被提升为可靠身份。需阻止该匹配，并保留明确选择当前行的入口。未发现额外范围扩张。

本次规范轴 0 项，规格轴 1 项 P1；尚未结项。

### P1 历史行修复

保存基线重复快照不参与唯一匹配提升，整个列表仍相同时才允许原出现项定位；变化后旧卡显示当前不可用。当前待同步选择器同时提供无法可靠映射到旧图的历史行，明确选择后进入当前编辑器，不创建图或持久身份。vlYsA4 红例、yk4uSV 绿例已通过真实 UI／422／两行隔离和服务端未写入核对；typecheck 通过。待固定提交复查。

## 最终复查：42d87d1

### Standards

已核实 HEAD：42d87d1c777a321650effa6e782a5312e0efea82。硬规则通过，无新增发现。重复历史快照在列表变化后不作为可靠身份；当前行选择器复用详情与统一保存，不创建图或补写身份。原不透明视图地址与共享按钮保持修复。按全部 12 项 baseline 复查，无新增可操作 smell；editCurrentObject 职责明确，不属于 Middle Man 或 Speculative Generality。本轴独立检查实现、文档及浏览器断言，没有重跑检查命令。

### Spec

已核实同一 HEAD。无新增发现，原 P1 历史行错绑已修复：保存基线重复时禁止重新匹配，仅全列表未变保留原出现项；当前选择器纳入不能安全映射的当前对象，不补 ID、不创建临时 graph。此前新增导演对象重进及新单元参考修复保持，符合 spec.md:191–193。累计 diff 未发现进一步遗漏、行为错误或范围扩张。本轴基于代码检查，未重复运行浏览器／全量测试。

最终 Standards 0 项，Spec 0 项，无剩余发现。主任务最终完整 graph 浏览器 sJF6Ni、legacy yk4uSV、设计范围 gYn88w、导演布局 ILmQjo 通过；后端 788 passed／19 skipped、前端纯逻辑 182 passed、typecheck、Pylint 10.00、diff --check 通过。详见 acceptance.md。

## 用户复审后的三项修复（基于 bf2e16c）

本次用户确认以 d264de4 至 bf2e16c 全量复审，Standards 发现两项 P2：原文节点布局仍使用固定显示 ID、单元长摘要裁切诊断；Spec 发现一项 P2：依赖核验刷新 ORM 行后，响应元数据与旧内容／图混合 revision。用户已授权逐项修复。

- 快照：新增版本 HTTP 回归，在数据库边界控制另一连接提交新 revision，复现响应 revision=2／三图 revision=1。固定首次内容读取时的响应元数据后，首次 HTTP 保持 1，下一次完整返回 2；graph 文件 27 passed。未改变接口 schema 或数据库隔离级别。
- 原文身份：不透明原文 ID 的实际浏览器先出现原文与事件重叠（9PwKVW）；锚点、焦点和有效节点使用后端地址，总览布局消费业务分组，旧缓存键通过适配迁移。完整导演布局 wq4UW6 通过，包含键盘移动、缓存写入、刷新恢复和窄屏。
- 摘要：长动作／参数的实际浏览器先确认诊断与详情均被裁出卡面（7aJF4F）；改用既有两行字段样式，并为诊断和操作保留区域。最终桌面与窄屏 AMb9Mv 通过：两行字段不裁成半行、诊断与按钮在卡内；五项真实参考只显示两个预览，详情仍有全部五项。完整 graph 回归 RMXkbB 通过。

修复验证完成：后端全量 789 passed／19 skipped，graph 文件 27 passed，前端纯逻辑 182 passed，typecheck、Pylint 10.00、diff --check 通过。19 项仍为需外部显式环境的集成测试。两轴复查待固定修复提交后执行；本节不覆盖前文固定 HEAD 的历史结论。
