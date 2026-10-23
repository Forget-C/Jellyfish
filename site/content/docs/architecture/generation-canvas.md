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
