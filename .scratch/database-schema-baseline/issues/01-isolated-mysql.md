# 01 建立专用 MySQL 测试库与连接保护

Status: ready-for-agent

Blocked by: None

父规格：[数据库结构清理与 Alembic 初始基线](../spec.md)

## What to build

为本轮开发与验收新建一个专用 MySQL 数据库，使正式迁移、种子、API 和 Worker 的测试均使用显式指定的同一目标。

## 验收条件

- [x] 在打开连接前识别缺失配置及误指当前数据库的配置。拒绝路径通过配置用例和连接调用断言验证，两种情况下均未发起连接。
- [x] 验证正常路径实际使用新建的专用库，并核对迁移、种子、API 与 Worker 测试各自生效的数据库目标。
- [x] 后续票据能复用同一测试入口，从本轮创建的数据开始验证。

## Comments

- 2026-11-20 完成并合入 `codex-database-schema-baseline`。通过独立数据库配置与连接保护测试。缺少目标或指向当前库时均在连接前拒绝；迁移、种子及后续 API 和 Worker 用例复用同一专用 MySQL 入口。
