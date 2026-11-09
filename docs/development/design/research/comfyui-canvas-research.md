# ComfyUI 多结果与局部执行调研

查阅日期：2026-10-23。本文记录来自官方文档和固定源码的外部项目事实。Jellyfish 的选择见[独立生成画布的边界与连接契约](../../adr/0001-independent-generation-canvas.md)。核查范围是核心能力的文档与源码，不含实例运行或社区插件。

源码固定为后端 [d07dff4565ea9804277fff8cdfa0c817e08c3d44](https://github.com/Comfy-Org/ComfyUI/commit/d07dff4565ea9804277fff8cdfa0c817e08c3d44) 与前端 [e5e13b8fe2ac68c5f8e4d5ec7bf153a135282dd2](https://github.com/Comfy-Org/ComfyUI_frontend/commit/e5e13b8fe2ac68c5f8e4d5ec7bf153a135282dd2)。这两个提交用于固定调查证据，不宣称是某个统一发行版；官方在线文档后续可能变化。

## 多结果是数据形态，预览选择不决定输出

ComfyUI 的 `IMAGE` 可以承载整批图片，形状为 `[B,H,W,C]`；单张图是批次大小为 1 的情况。因此一个图片输出端口不等于一张图片。[官方图像类型文档](https://docs.comfy.org/custom-nodes/backend/images_and_masks)

图片批次与执行引擎的数据列表是两层概念：整个图片批次可以只是数据列表中的一项。`OUTPUT_IS_LIST` 声明输出按列表传递，默认下游逐项调用；`INPUT_IS_LIST` 允许节点一次接收整个列表。不能把“模型一次生成四张图”“四张图共同作为一次调用的参考”和“下游调用四次”混为一谈。[官方列表处理文档](https://docs.comfy.org/custom-nodes/backend/lists)

本次源码中，`SaveImage` 遍历并保存所有输入图片，独立返回界面预览数据与完整图片结果；`PreviewImage` 复用这一处理，只将文件写入临时目录。多张图片不会在这些核心节点中触发人工选用门槛。[SaveImage / PreviewImage 源码](https://github.com/Comfy-Org/ComfyUI/blob/d07dff4565ea9804277fff8cdfa0c817e08c3d44/nodes.py#L1669-L1745)

前端点击缩略图改变 `node.imageIndex`，用于绘制当前大图；提交执行的连接只包含来源节点与输出端口，没有这个预览索引。因此普通预览中正在查看哪张图，不改变下游接收的数据。这是对两条源码路径的联合判断。[预览交互](https://github.com/Comfy-Org/ComfyUI_frontend/blob/e5e13b8fe2ac68c5f8e4d5ec7bf153a135282dd2/src/renderer/extensions/vueNodes/widgets/composables/useImagePreviewWidget.ts#L92-L119)、[连接序列化](https://github.com/Comfy-Org/ComfyUI_frontend/blob/e5e13b8fe2ac68c5f8e4d5ec7bf153a135282dd2/src/utils/executionUtil.ts#L153-L165)

## 选取某张图片是明确的数据处理

内置 `ImageFromBatch` 接收图片批次，以 `batch_index` 和 `length` 返回子批次；默认长度为 1。不同下游需要不同图片时，可以在各分支放置独立选取节点，设置不同索引。后一句是基于该节点输入输出契约的组合推论，不是预览面板提供的“全局采用”功能。[ImageFromBatch 源码](https://github.com/Comfy-Org/ComfyUI/blob/d07dff4565ea9804277fff8cdfa0c817e08c3d44/comfy_extras/nodes_images.py#L289-L313)

所核查的标准路径没有“返回多个结果就自动暂停，让用户选一个再继续”的通用规则。要实现人工审核暂停，应作为明确的额外能力设计，不能从 ComfyUI 的图片批次或预览选择行为推导出来。[列表处理规则](https://docs.comfy.org/custom-nodes/backend/lists)、[标准保存与预览节点](https://github.com/Comfy-Org/ComfyUI/blob/d07dff4565ea9804277fff8cdfa0c817e08c3d44/nodes.py#L1702-L1745)

## 重新执行、当前展示与历史分别处理

执行端读取来源输出端口对应的缓存数据，不读取预览选中的图片索引。成功计算后更新该节点的执行缓存；运行历史另按请求身份记录。由此不能把“当前节点预览”“本次执行输出”和“历史产物”视为同一份状态。[输入读取](https://github.com/Comfy-Org/ComfyUI/blob/d07dff4565ea9804277fff8cdfa0c817e08c3d44/execution.py#L164-L195)、[输出缓存](https://github.com/Comfy-Org/ComfyUI/blob/d07dff4565ea9804277fff8cdfa0c817e08c3d44/execution.py#L617-L619)、[请求历史](https://github.com/Comfy-Org/ComfyUI/blob/d07dff4565ea9804277fff8cdfa0c817e08c3d44/execution.py#L1340-L1359)

前端输出存储支持明确的合并模式；普通更新会替换该节点的展示输出。这是显示状态更新，不是用户在全部历史候选中选定一张供所有下游共同使用。[nodeOutputStore 源码](https://github.com/Comfy-Org/ComfyUI_frontend/blob/e5e13b8fe2ac68c5f8e4d5ec7bf153a135282dd2/src/stores/nodeOutputStore.ts#L193-L229)

ComfyUI 根据输入与控件变化判断缓存是否仍可使用；重新提交工作流不代表所有计算节点强制重跑。[官方缓存与 IS_CHANGED 说明](https://docs.comfy.org/custom-nodes/backend/server_overview#execution-control-extras)

## 局部执行与框选强制重跑的差异

官方 Partial Execution 面向选中的输出节点，例如预览或保存节点，执行通向该输出的必要分支。前端先筛选输出节点再提交目标列表，后端也仅将匹配列表的输出节点作为执行目标；仍使用依赖与缓存机制。它不能直接证明“任意框选节点都必须重新运行”的行为。[官方局部执行说明](https://docs.comfy.org/interface/features/partial-execution)、[前端命令](https://github.com/Comfy-Org/ComfyUI_frontend/blob/e5e13b8fe2ac68c5f8e4d5ec7bf153a135282dd2/src/composables/useCoreCommands.ts#L562-L598)、[后端目标筛选](https://github.com/Comfy-Org/ComfyUI/blob/d07dff4565ea9804277fff8cdfa0c817e08c3d44/execution.py#L1182-L1184)

所核查后端在执行错误后跳出当前调度循环。因此 Jellyfish 已确认的“无依赖分支继续执行”属于自身产品选择，不应标为沿用 ComfyUI 核心失败策略。[执行循环](https://github.com/Comfy-Org/ComfyUI/blob/d07dff4565ea9804277fff8cdfa0c817e08c3d44/execution.py#L786-L800)
