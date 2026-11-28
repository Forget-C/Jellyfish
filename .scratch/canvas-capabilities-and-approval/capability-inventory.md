# 画布能力覆盖清单

按现有业务操作盘点。适用范围来自真实归属与现有卡片目录。操作名采用 HTTP 契约中的 operation ID，便于在 04 逐项核对普通后端入口。

| 协议组 | 适用画布 | 公开业务操作 | 承接票 |
| --- | --- | --- | --- |
| 生命周期、读取与能力 | 自由 | 摘要分页与检索、创建、重命名、读取未保存草稿（`canvas_list`、`canvas_create`、`canvas_rename`、`canvas_draft_read`） | 01 |
| 生命周期、读取与能力 | 分镜 | 按场次列出画布、从已确认原文创建分镜画布（`directing_scene_canvases`、`directing_scene_canvas_create`） | 01 |
| 生命周期、读取与能力 | 两种 | 读取当前文档及修订、按修订删除、查询卡片目录和模型能力（`canvas_get`、`canvas_delete`、`canvas_catalog`、`canvas_model_capability`）。未保存自由画布可查询同一目录的自由画布投影（`free_canvas_catalog`）。 | 01 |
| 编辑预演、提交与回执 | 两种 | 卡片、字段、位置和分组变更，关系、实际输入、封面和场次适用字段的保存（`canvas_save`）；包含批量预演、差异、冲突、回执、重放。 | 02 |
| 编辑预演、提交与回执 | 自由 | 首次提交现有未保存草稿（`canvas_draft_save`）。 | 02 |
| 编辑预演、提交与回执 | 分镜 | 场次候选应用前差异、应用、撤销与重做（`directing_storyboard_diff`、`directing_storyboard_apply`、`directing_storyboard_restore`）；保存时同步验收要求与设计绑定。 | 02 |
| 生成输入解析与编译 | 两种 | 解析实际采用的正文、参考及生成配置，检查并编译指定卡的单次输入（`canvas_compile`、`canvas_precheck`）；由选定视频准备参考帧（`canvas_prepare_video_frame`）。 | 03 |
| 生成输入解析与编译 | 分镜 | 解析设计与验收要求；查看画布生成检查和产出检查依据（`canvas_check_preview`、`canvas_check_products`、`canvas_post_check_preview`）。场次业务继续负责分镜提取及重试的项目、场次和来源准入（`directing_storyboard_basis`、`directing_storyboard_retry_basis`）。 | 03 |
| 生成运行与结果 | 两种 | 提交单卡运行，查询快照、事件和恢复游标，取消运行或节点（`canvas_run_submit`、`canvas_runtime`、`canvas_stream_connection`、`canvas_events`、`canvas_cancel_run`、`canvas_cancel_node`）；查看输出或转为可用内容卡（`canvas_card_outputs`、`canvas_output_content`）。 | 04 |
| 生成运行与结果 | 分镜 | 执行和取消画布生成前后检查，读取报告与归档，重查（`canvas_check_run`、`canvas_post_check_run`、`canvas_check_reports`、`canvas_check_cancel`、`canvas_check_archived_reports`、`canvas_check_recheck`）。 | 04 |
| 生命周期、生成运行与结果 | 分镜 | 通过场次业务创建目标画布、提交和重试分镜提取、读取任务与候选、提交和读取连续性检查（`directing_storyboard_submit`、`directing_storyboard_reextract`、`directing_storyboard_retry`、`directing_storyboard_list`、`directing_storyboard_get`、`directing_storyboard_candidate`、`directing_saved_storyboard_check_submit`、`directing_saved_storyboard_check_get`）。保留场次准入和候选语义，验收这些入口所用的画布生命周期、编辑与运行能力。 | 04 |

首页近期画布摘要（`home_recent_canvases`）是面向首页、跨项目的限量投影，依赖同一归属语义。它保留独立查询，核对两种画布的归属和可跳转身份。对话队列、消息、模型选择、审批偏好和提案决定由会话及审批层承接。运行事件的 SSE 连接与事件传输仍由 HTTP 适配器负责。

## 协议验收

已将上述 47 个 operation ID 与现有路由核对。普通后端调用方可按职责组合以下入口，使用调用方已授权的画布作用域和事务。

| 职责 | 协议入口 | 特殊宿主行为 |
| --- | --- | --- |
| 生命周期、读取与能力 | `canvas_lifecycle`、`free_canvas_lifecycle`、`scene_canvas_lifecycle` | 新建自由画布的未绑定卡片目录复用同一份目录。首页跨项目摘要保留聚合查询。 |
| 编辑预演、提交与回执 | `canvas_edits`、`free_canvas_edits`、`scene_storyboard_edits` | 布局投影以宿主提供的浏览器坐标为依据，由宿主应用。 |
| 生成输入解析与编译 | `canvas_generation_inputs`、`storyboard_generation_inputs` | 预检可返回运行凭据。参考帧准备单独产出素材，采用由编辑操作确认。 |
| 生成运行与结果 | `canvas_runs`、`canvas_check_runs`、`storyboard_runs` | HTTP 组织 SSE 地址、连接和心跳，每次读取短事务调用运行事件协议。 |

普通后端调用方可按原请求标识读取受理回执，并按其中的任务标识查运行和产出。双画布用例贯穿两个镜头的编辑、编译与单卡提交，模拟调用方未收到受理响应和供应商完成产出，核对恢复时只派发一次。
