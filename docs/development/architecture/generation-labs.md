# 生成实验室架构

## 会话、输入与历史

`/lab` 由 `ExperimentLabPage` 提供跨模态会话列表、布局及路由。旧模态入口保留查询参数并跳转到此页。URL 的 `session` 指向会话，`mode` 指向未持久化草稿。恢复顺序为显式选择、最近更新会话、文本草稿。首次有效提交才创建会话；删除当前会话后打开剩余最新会话或文本草稿。

文本、图片、视频模态各自负责输入能力、提交和结果展示。通用 Composer 与模型及模板选择器复用；变量表单按模板声明生成，转为自由输入只复制渲染提示词。模型和模板在首次打开选择器时加载，和会话、资料库的加载状态分开。

`experiment_sessions` 和 `experiment_messages` 共用存储，按 `lab_type` 区分。历史按会话内单调 `sequence` 排序，服务端提供分页、重命名、删除与清空。删除和清空锁定会话并拒绝活动任务。会话当前为全局数据。历史供用户查看；文本每轮模型请求只带本轮内容。实验室任务的目标为 `experiment_session`，项目、资产及场次生产另有各自入口。

## 文本流

文本页面使用 `POST /api/v1/studio/labs/text/sessions/{session_id}/stream`，提交选定文本模型与本轮提示词。服务器在发出 `accepted` 前提交用户消息并创建进程内 SSE 运行。SSE ID 按 `sequence` 递增，后续传输 `delta`、`progress` 和单一终态 `completed`、`error` 或 `cancelled`。成功写入助手消息后才发出 `completed`。

此流式入口不创建持久异步任务。停止通过会话绑定的 `POST /api/v1/studio/labs/text/sessions/{session_id}/runs/{task_id}/cancel` 取消隐藏运行，断开连接时服务端也请求取消未终态运行。隐藏运行不进入任务中心。

## 图片与视频任务

- 图片选择器提供首帧、尾帧、关键帧、角色、演员、道具、场景正面与其他视角、服装等图片模板。参考项按选入顺序传递资料库 `file_id`、`media_kind` 和 `ordinal`。
- 视频使用 `video_prompt` 类提示词模板和画幅。界面从 `GET /api/v1/llm/video-generation-options` 获取所选模型的画幅和媒体能力。具名帧槽为 `frames.first`、`frames.last`、`frames.keys`，当前界面各槽选择一张图。命名 `subjects` 独立表达主体的有序图片或视频，主体名在同次提交唯一。实验室界面限制主体与帧互斥，服务端按模型能力验证输入及组合。供应商映射及能力配置见[供应商注册与扩展](../guides/llm-provider-registration.md)。
- 固定模态入口为 `POST /api/v1/studio/generation-tasks/labs/{image|video}/sessions/{session_id}/tasks`。路径约束会话模态、生成 operation 和媒体结构。服务端校验资料库引用、文件类型和模型能力；实际供应商媒体表示由 Worker 执行时解析。
- 用户消息、带任务标识的任务消息及任务记录在同一数据库事务内写入，由持久任务表驱动 Worker。消息正文是展示投影。执行以 `Task.input_snapshot` 和持久输入关系为准，媒体任务在受理时固定执行配置。任务接口及实验室历史不公开私有执行配置。任务状态与恢复见[任务执行架构](../../../site/content/docs/architecture/task-execution.md)。
- 提交返回任务标识和两条已持久化消息。前端按消息 ID 去重、按 `sequence` 排序，并叠加任务轮询状态。历史状态、错误和文件结果由任务事实派生，终态继续显示在原任务消息位置。成功媒体按统一文件流程归档，供历史预览。

## 历史查看与回填

文本回填本轮提示词和已有模型标识，清除模板及变量。图片、视频回填提示词，清除模板变量及媒体参考，模型与设置由用户重新核对。历史展示可以读取任务输入投影中的参考标识和画幅；这不构成完整输入恢复。文件失效时显示不可用。回填只改变编辑草稿；下一次提交建立新的消息和运行或任务。
