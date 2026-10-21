# 共享 graph 改造代码审查

固定基线：`d264de4738484306d5b1b17ad588803546d31ac6`。
首次实现提交：`06f79c1b7ca6b38798d39401517d91bb82c4cb4a`。
审查命令：`git diff d264de4738484306d5b1b17ad588803546d31ac6...HEAD`，首次审查时 HEAD 即上述提交。

按 code-review 技能由独立 Standards／Spec 审查者并行执行，以下分轴保留结果，不合并或跨轴排序。最终修复和复查尚未完成。

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
