# 01 画布生命周期、读取与能力查询

阶段 1 · 完整画布能力协议

**What to build:** 普通后端调用方可通过进程内 Python `typing.Protocol` 管理并读取两种画布，按当前资源查询可用操作。

**Blocked by:** None

**Status:** ready-for-agent
Completion: complete

- [x] 从自由画布和分镜画布各自的后端入口盘点公开操作，逐项标明适用画布、所属协议组及承接票。
- [x] 普通调用方在没有助手会话时即可完成各自已支持的生命周期操作，读取对应画布文档。
- [x] 自由画布的能力查询排除设计卡；分镜画布的结果反映其现有设计卡规则。调用方只能读取其已获授权的资源。

## 验收记录

实现提交为 `91523e5d`。[能力清单](../capability-inventory.md)登记了两种画布的 47 个公开操作。

生命周期、生成画布 API 和分镜画布摘要用例共 64 项通过。隔离 MySQL 的 2 项用例因未配置 `JELLYFISH_TEST_MYSQL_URL` 跳过。后端应用 Pylint 检查通过。
