---
title: "生成画布文档存储"
description: "独立项目画布当前已实现的文档、保存及页面边界。"
---

# 生成画布文档存储

项目工作台的“画布生成”入口无需章节或场次。一个项目可创建多张命名画布，通过 URL 的 `tab=generation&canvas=<id>` 重开。首个切片支持文本内容卡和手动保存；自动保存、布局、媒体、连线和执行按生成画布规格后续票据实现。完整设计决策见 [独立生成画布](adr/0001-independent-generation-canvas.md) 与 [协议边界](adr/0002-generation-canvas-protocol-boundaries.md)。

`generation_canvases` 保存项目归属、当前完整文档、内容 revision 和已登记卡片身份／类型。文档包含画布身份、项目身份、名称、schema_version 及卡片。文本卡使用 `content.text`、type_version 1、不可变 ID 和一份 text，允许空字符串。后端 `CardDefinition` 及前端 `rendererRegistry` 已由文本编辑器消费。布局、运行状态与运行结果不进入此文档。

HTTP 边界为 `/api/v1/studio/generation-canvases/{project_id}` 的列表／创建，以及 `/{canvas_id}` 的读取／PUT 保存／删除。读取、写入和删除均限定项目归属，沿用现有项目 API 的访问边界。前端普通请求由 OpenAPI generated client 发出。

保存提交 `request_id`、`expected_revision` 和完整 `document`。事务先锁文档行，再核实持久回执，最后执行 revision CAS。文档更新和 `generation_canvas_save_receipts` 在同一事务提交。同请求重放原回执，不因后续 revision 改变；同身份不同正文返回 HTTP 409 `IDEMPOTENCY_CONFLICT`，过期修订返回 HTTP 409 `REVISION_CONFLICT`。结构、类型和身份错误返回带 `code`、`severity`、`message`、`target`、`blocks` 的文档诊断。HTTP 命令封套的基本校验仍使用 FastAPI 422 格式。

迁移 `d6a0b4c8e957` 建立两张表。MySQL 验证使用显式隔离测试库与独立 HTTP 请求事务，覆盖 CAS、同请求竞争及迁移／模型一致性；SQLite 用于功能持久化与真实页面旅程，不能代替 MySQL 竞争证据。
