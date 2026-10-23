---
title: "生成画布文档存储"
description: "独立项目画布当前已实现的文档、保存及页面边界。"
---

# 生成画布文档存储

项目工作台的“画布生成”入口无需章节或场次。一个项目可创建多张命名画布，通过 URL 的 `tab=generation&canvas=<id>` 重开。当前支持四类内容卡、三类模型卡、候选连接、分组、独立布局以及自动保存和恢复保护。模型卡用于编辑配置，尚未提供运行。完整设计决策见 [独立生成画布](adr/0001-independent-generation-canvas.md) 与 [协议边界](adr/0002-generation-canvas-protocol-boundaries.md)。

`generation_canvases` 保存项目归属、当前完整文档、内容 revision 和已登记卡片身份／类型。文档包含画布身份、项目身份、名称、schema_version、卡片、候选连接、每目标端口独立输入顺序和分组。文本卡使用 `content.text`、type_version 1、不可变 ID 和一份 text，允许空字符串。后端轻量 `CardDefinition` 使用具体卡类型，前端显式 `rendererRegistry` 和 `CardShell` 消费同一文档。布局、运行状态与运行结果不进入此文档。

HTTP 边界为 `/api/v1/studio/generation-canvases/{project_id}` 的列表／创建，以及 `/{canvas_id}` 的读取／PUT 保存／删除。读取、写入和删除均限定项目归属，沿用现有项目 API 的访问边界。前端普通请求由 OpenAPI generated client 发出。

保存提交 `request_id`、`expected_revision` 和完整 `document`。事务先锁文档行，再核实持久回执，最后执行 revision CAS。文档更新和 `generation_canvas_save_receipts` 在同一事务提交。同请求重放原回执，不因后续 revision 改变；同身份不同正文返回 HTTP 409 `IDEMPOTENCY_CONFLICT`，过期修订返回 HTTP 409 `REVISION_CONFLICT`。结构、类型和身份错误返回带 `code`、`severity`、`message`、`target`、`blocks` 的文档诊断。画布领域异常使用标准 `{code,message,data,meta}` 封套，`data` 保留类型化诊断；不从 message 反解析字段。普通 HTTP 异常仍保持原有 `data=null`，命令封套基本校验沿用统一 422 处理。

迁移 `d6a0b4c8e957` 建立两张表。MySQL 验证使用显式隔离测试库与独立 HTTP 请求事务，覆盖 CAS、同请求竞争及迁移／模型一致性；SQLite 用于功能持久化与真实页面旅程，不能代替 MySQL 竞争证据。

媒体内容卡使用 `content.image`、`content.video`、`content.audio`，只有各自模态的一个输出位置，没有输入。`file_id` 可为空；`uploading=true` 时即使保留旧文件也不发布有效输出。替换与清空引用保留卡片身份。保存通过真实文件记录核实类型、可用性和项目归属，以 `canvas_content` usage（`canvas_id:card_id`）保护引用，删卡／删画布只释放自己的内容引用。

上传使用项目文件接口，以 `generation_upload` usage 独立保留项目文件，成功后不随画布保存失败或放弃编辑回滚。迟到上传不会重建已删除的卡片，文件仍可在项目库选择。图片、完整视频和音频通过既有文件下载接口预览，音频支持 MP3、WAV、OGG、M4A、AAC、FLAC、OPUS。`DELETE /api/v1/studio/files/{file_id}/upload-retention?project_id=...` 显式释放本项目的画布上传保留，有其他真实使用关系时返回 409；清除其他引用后可重试，再按需调用已有文件删除接口，释放本身不删除字节。


模型卡以 `model.text`、`model.image`、`model.video` 区分能力模态，不按供应商复制卡类型。前端复用受控 `ExperimentComposer` 的正文和底部参数布局；文本请求沿用模型管理参数，当前仅接收文本。图片卡配置画幅、分辨率档位和数量；视频仅配置画幅、时长与高级随机种子。`/{canvas_id}/models/{model_id}/capability` 从已接入 DTO 和真实图片／视频能力解析器派生用途、组合、数量及参数范围，未知模型或加载失败保留现场并提示。

候选边以 `source_card/source_port/target_card/target_port` 定义端点用途，`input_order[接收卡][端口]` 持久保存独立边 ID 顺序。新边追加、重复端点拒绝；自连、循环、损坏端点、损坏顺序和分组成员阻止保存并返回定位诊断。卡片移动或分组不改变输入顺序。新建不兼容连线在 UI 拒绝；同模型下新增边在保存时也核实能力。切换模型保留配置和候选，包括切换前尚未单独保存的边；保存不要求操作日志，模型变化时保留结构有效的候选。能力不匹配与无效参数提供运行级诊断，不阻止保留编辑现场；实际使用判断属于提示词编译边界。

分组仅保存名称、独立成员和折叠状态，解散不会删除成员。几何、尺寸、视角通过 `useGraphLayout` 按项目／画布独立保存在浏览器；分组整体移动也只更新几何，不产生内容 PUT。折叠仍保留成员布局和连接顺序，分组没有集合输出。存储失败显示布局保护警告，继续保留本次会话内布局。

模型正文使用编辑器无关的 `PromptDocument.segments`：`text` 保存原文，`reference` 保存稳定来源，`instruction` 保存命令、参数及引用。片段 ID 与指令内引用 ID 在同一正文内唯一，用于诊断定位；不使用正文偏移。输出身份为 `{canvas_id,card_id,port_id,position}`，不按文件 ID 合并来源。输入重排只改变接收代号，已绑定身份不变。空卡和无结果模型不提供可选择的输出；仍被引用的缺失位置保留占位。

共用编辑器支持按分类选择、完整代号确认、中文组合输入、转义及结构化剪贴载荷 `application/x-jellyfish-prompt+json`。输入 `@` 打开候选列表；输入过程中只匹配，在选择、Enter／Tab、明确分隔符或失焦时才绑定完整代号。组合输入期间不转换。同画布粘贴保留来源，未连接时要求手工连接；跨画布载荷保留外来身份并诊断，不自动复制卡片或按同名代号换绑。外部纯文本按目标当前代号确认。添加入口创建可见内容卡并连接，选择已有卡只新增候选边。

`services/generation_canvas/compiler.py` 的公开 `compile_card` 与 `resolve_outputs` 解析实际引用。内容输出来自真实内容卡；运行层通过独立的 `model_outputs` 参数提供已发布的模型当前结果，不把结果写入编辑文档或虚构未来输出。编译仅在结构化引用处展开文本一次，实际媒体按接收端顺序选出使用子集，并提供本地代号、稳定来源与实际媒体位置映射。通用 `[media:N]` 表达是基础编译映射，供应商请求表达由对应模态执行适配消费。

`GET /{canvas_id}/cards/{card_id}/compile` 返回已保存正文的基础编译预览、实际使用集合、映射及结构化诊断，不提交任务。保存未完成正文与允许运行分开；未使用的不兼容候选是 warning 且不阻塞，实际使用的不兼容输入与无效参数阻止运行。正文和指令内实际引用共同保护断线及删除来源，定位到稳定片段；保存检查最终文档，因此可清理引用后立即断线／删卡并一次保存。视频指令的具体供应商字段映射和运行预检由后续运行实现消费此边界。
