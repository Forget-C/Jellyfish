---
title: "接入共享画布 graph"
description: "后端投影、共同校验、前端渲染与编辑保存的复用步骤和边界。"
---

# 接入共享画布 graph

导演与单元画布使用版本接口返回的 `director_graph`、`unit_graph`。业务内容保存在原 `SceneVersionContent`；graph 是同一次读取的展示投影，不是另一份可保存的业务数据。当前指令与剪辑画布没有迁移到该协议。

## 后端接入步骤

1. 在 `app/core/contracts/directing/canvas_graph.py` 复用 `CanvasObject`、`CanvasTarget`、`CanvasNode`、`CanvasEdge`、`CanvasMember`、`CanvasView` 和 `CanvasIssue`。业务节点使用有判别字段的具体类型，新增载荷保持明确字段，不接入任意 JSON 表单。
2. 由 `DirectingStore` 完成项目、场次及版本鉴权，读取强类型内容和 revision；使用 `CanvasReadContext.load` 为同一快照加载共同证据。模型、文件、固定风格及依赖有效性调用既有服务，不在投影器里重新实现鉴权或准备流程。
3. 在 service 层编写领域投影函数，参考 `director_canvas.py` 与 `unit_canvas.py`。使用 `GraphAssembler.add_node/add_edge/add_view/add_issue` 注册对象，最后调用 `finish` 并构造具体 graph 类型。构建器不做 I/O，领域投影器负责真实成员、摘要、分组、入口和问题。
4. 每个显示节点使用唯一 ID，并通过 `object` 保留实际业务身份及内容路径；节点 ID、视图 ID 对消费者是不透明地址。配置字段只声明实际可编辑的内容。历史无稳定 ID 对象设为 `stable=false`，其身份限定在当前 revision，不在读取时补写 UUID。
5. 成员复用节点，不复制业务单元；聚合入口提供 `entry_view_id`，节点提供 `home_view_id`，视图提供父级和锚点；每张图只有一个 parent_id 为空的根视图，消费者读取其返回 ID，不约定根地址字符串。所有边必须有真实来源，缺失业务引用明确返回问题或缺失节点。不要静默删边来伪装完整。
6. 保持版本内容、两图和目标的 version/revision 一致。读取和保存均返回完整快照；API 只负责收参、鉴权入口和响应，不组装图。

共同校验会拒绝重复节点／边／视图、悬空端点或成员、无效入口与编辑目标、循环层级、快照不一致及不闭合的来源定位。视图数量和分组计数由构建器统一计算，具体业务诊断由投影器提供。

## 证据与执行边界

`CanvasReadContext` 批量读取视频模型与项目可见文件，复用固定项目风格和真实依赖校验。`unit_video_inputs.py` 提供真实执行与图共同使用的模型解析、适配器参考能力和输入元数据校验；它不读取媒体字节，也不提交任务。未知模型或供应商配置返回未核实问题。

参考集合保留每个绑定的 ID、用途、输入角色与顺序；文件预览仅表示当前登记及可访问地址，不宣称媒体字节或生成准备已经通过。依赖证据保留固定计划／场次、单元／采用、实际帧和参考绑定身份，区分未绑定、有效、待复核和不可用。外部模型、文件和采用变化可以在场次 revision 不变时改变重新读取的证据。

只读执行依据复用 `unit_scope`，分别表达执行项、约束、背景与未解决项；来源按钮使用服务端明确返回的 `CanvasBasisTarget`。无法定位的固定来源显示原因，不按同名或数组位置猜测。结构通过、范围支持、生成准备、任务成功、素材审查与剪辑采用始终是不同状态。最终编译、预检和执行仍重新校验真实输入。

## 前端接入步骤

- 从 OpenAPI generated client 消费具体 graph 类型；业务节点、关系、摘要、计数、问题及视图成员由后端提供，前端不从业务数组重新拼图。先核对 graph 与版本快照，失败显示明确错误。
- 复用 `GraphCanvas`、`GraphSubgraphPreview`、`graphLayout`、`useGraphLayout` 与 `useGraphBrowse`。前端负责几何、视口、缓存和浏览历史；业务布局尺寸与旧缓存迁移保留在对应适配器中。
- 使用返回的视图和定位地址导航，不解析 ID 前缀或用第一 coverage 替代精确单元。镜头筛选只选择后端视图，不裁剪完整单元子图。
- 摘要消费已保存 graph；详情按稳定业务 ID 编辑当前暂存内容。旧 graph 的对象若已在当前编辑中移除，提示不可用，不选替代对象。未保存新对象继续沿用当前编辑入口，保存后获得后端 graph。无 ID 历史行若在保存基线中重复，不把编辑后剩余的唯一同内容行当作身份；旧卡暂不可编辑，使用“编辑待同步对象”明确选择当前行。
- 复用 `WorkbenchDetails`、主题和现有详情。需要定位输入时传入 `focusTarget`，由详情在实际可见后聚焦字段，避免先对隐藏内容设置焦点。
- 保存统一走 `CanvasSequenceWorkbench` 现有串行队列、5 秒周期及手动入口；不要为 graph、配置卡或新画布另建保存接口、草稿实体或自动提交链。

## 验证与接口同步

共同契约测试应覆盖两个具体投影器和非法结构；版本 HTTP 用例核对读取／保存快照、实际来源与外部证据变化。真实浏览器验证导航、详情编辑、旧图与当前输入分离、失败恢复和精确回跳。当前回归入口包括 `test_canvas_graph.py`、`test_scene_dependencies.py`、`sceneCanvasGraph.browser.mjs`、`sceneLegacyGraph.browser.mjs` 和 `scenePeriodicSave.browser.mjs`。

对外 schema 变化后，先核实 8000 端口加载当前工作区后端，再从仓库根目录运行 `pnpm --dir front run openapi:update`。随后执行受影响测试、前端 typecheck 和后端 Pylint；工作台展示与键盘、窄屏检查遵循[工作台前端设计标准](/docs/guide/workbench-design/)。
