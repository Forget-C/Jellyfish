# 数据库迁移与系统种子

日常维护见[数据库升级与回退](../guides/database-upgrade.md)。

## 执行链路

Compose 在 MySQL 就绪后按下列依赖启动服务。本地分开启动时也先迁移和种子，再启动 API 和 Worker。

```text
MySQL healthy
→ backend-migrate
→ backend-seed-system-data
→ backend / task-worker
```

`backend-migrate` 执行 `app.scripts.migrate_database`，使用 `DATABASE_URL` 连接数据库：

- 空数据库执行 `alembic upgrade head`；
- 已有 `alembic_version` 的数据库执行升级到 `head`；
- 非空但没有 `alembic_version` 的数据库直接拒绝，不通过当前 ORM 表名猜测旧版本；
- 未纳管数据库必须使用空库，或由维护者核对结构后显式建立正确基线。迁移入口不会自动 stamp。

结构变更只通过 `backend/alembic/versions/` 下的 Alembic revision 发布。开发命令 `backend/init_db.py` 也调用同一迁移入口；`Base.metadata.create_all()` 只用于隔离测试，不用于应用初始化。

## Alembic 配置

- `backend/alembic.ini` 定义 backend 本地脚本位置；
- `backend/alembic/env.py` 读取应用的 `settings.database_url`；
- `env.py` 显式导入 `app.models`，并使用 `Base.metadata` 支持 revision autogenerate；
- 异步驱动通过 SQLAlchemy 的 `run_sync` 桥接执行 Alembic，因此运行时和迁移共用 `mysql+aiomysql` URL。

应用运行连接在 MySQL 使用 READ COMMITTED，避免文件删除检查沿用旧快照；迁移独立连接不承担应用并发读取。

## 系统种子

`backend-seed-system-data` 在迁移完成后运行 `app.scripts.seed_system_data`：

- 当前只处理系统提示词模板；
- 同一事务内替换固定 ID 的系统提示词模板，正常重复执行保持模板数量稳定。
- 删除条件限定固定 ID 且 `is_system = 1`。用户模板使用系统保留 ID 时，插入冲突会使种子事务失败，维护者需先核对冲突来源。
- 种子读取 `backend/sql/001-init-prompt-template.sql` 中的删除和插入语句。Compose 直接调用种子入口。

历史 Alembic 模板迁移的作用范围与系统种子不同。演员设定图迁移会删除 `actor_image_front` / `actor_image_other` 模板及关联的未完成演员图片任务，并写入唯一的 `actor_image` 系统模板。已完成任务的结果文件和已有演员图片关联不受影响。

角色、道具和服装使用同样的迁移规则：清理各自旧的正面/其他视角模板和未完成图片任务，写入单一默认模板；已生成的图片文件和关联保持不变。

旧的结构迁移 SQL (`002`—`008`) 仅作为历史与短期回退资料保留，不参与当前启动链路。

## 任务与文件收敛迁移

`13b6a9d2e401` 接在 `f2a3b4c5d6e7` 后：创建 tasks、task_inputs、task_outputs，删除旧任务、Run、Artifact、ProviderOperation、Blob 和 outbox 等执行表；调整 files 为唯一对象身份，并将 project_id 加入文件使用关系唯一键。

此迁移不转换旧任务历史；业务表、已有文件 ID、storage_key 和对象存储字节保留。旧 thumbnail URL 与 content_version 移除，已有文件的 content_type 初始化为 application/octet-stream。新任务从新表形成历史。旧实验消息中已失效的任务关联不会被解释为新任务状态。

升级前必须停止 API 与新旧 Worker，备份数据库。文件 key 按数据库 `LENGTH` 计算超过 700或多条文件记录共享同一 key 时，迁移在任何 DDL 前失败，不自动截断或合并。MySQL DDL 不具备整段事务回滚能力；失败后先核对已执行步骤，不盲目重跑。此收缩迁移不支持 downgrade，回退需恢复备份并使用对应旧代码。

隔离 SQLite 适合验证应用逻辑。迁移实际 DDL、索引和外键结构及并发约束应在目标版本的隔离 MySQL 中核对。
