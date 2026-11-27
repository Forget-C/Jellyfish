# 01：实验室多模态聊天接入统一会话路径

Status: ready-for-agent

Completion: resolved

Integration commit: 34ba5642
Blocked by: None

## What to build

用户打开实验室多模态聊天后，页面只绑定一次会话类型与身份，通过同一基础客户端发送、订阅和恢复历史。

## Acceptance criteria

- [x] 仅含会话 ID 的深链接在打开时解析类型；后端拒绝类型与持久会话不匹配的请求。
- [x] send、events、snapshot 采用相同的类型与会话 ID 路径约定；慢模型仍在执行时发送已返回包含 session_id、turn_id、cursor 的 HTTP 202。
- [x] 快照含有序消息、部分回复、当前追问、模型选择以及工具与产物的关联。从快照游标订阅可补读期间提交的事件，并继续收到新事件。
- [x] 工具失败在实时流与历史中按同一消息身份展示。同步公开契约和生成客户端，已有页面在迁移期间仍可工作。
