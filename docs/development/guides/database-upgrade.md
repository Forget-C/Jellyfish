# 数据库升级与回退

## 升级前核对

1. 核实目标环境的数据库连接与当前运行版本。用 `alembic current` 查数据库版本，用 `alembic heads` 查当前代码期望的版本。确认 API 与独立 Worker 使用预期数据库。
2. 查阅[迁移影响](../architecture/database-migrations.md#任务与文件收敛迁移)。跨越任务与文件收敛 revision 时，核对文件 key 长度及重复 key，了解旧任务历史和旧字段的处置。历史模板迁移也可能清理旧类别模板及未完成的相关生成任务。
3. 停止 API 与新旧 Worker，完成数据库备份并核实恢复路径。需验证实际 DDL 或并发行为时，使用与目标版本匹配的隔离 MySQL。
4. 非空且无 Alembic 版本的库先核对结构，再由维护者显式建立正确基线。结构无法确认时选用空库。不要以 `stamp head` 跳过迁移。

## 执行升级

Compose 依次运行迁移和系统种子服务，成功后才启动 API 与 Worker。独立维护时，在 `backend` 目录使用当前工作区配置：

```bash
uv run alembic current
uv run alembic heads
uv run python -m app.scripts.migrate_database
uv run python -m app.scripts.seed_system_data
uv run alembic current
```

确认版本与当前代码一致、种子成功，随后按开发或部署入口启动 API 和单个 Worker。检查 API 健康状态和 Worker 日志。系统种子替换固定系统模板，相关范围见[系统种子](../architecture/database-migrations.md#系统种子)。旧 SQL 文件仅供历史查阅，不放回启动链路。

## 处理失败与回退

MySQL DDL 可能已部分生效。失败后先核实版本与实际表结构，确认执行到哪一步再处理。任务与文件收敛 revision 无 downgrade，回退需恢复升级前备份并使用与备份对应的应用代码。核验记录以目标环境的实测为准。

## 开发迁移

在 `backend` 目录运行 `uv run alembic revision --autogenerate -m "describe schema change"` 可生成候选 revision。提交前人工审查 MySQL DDL、索引、外键与现有数据兼容性。

## 独立画布归属升级

`c5e12a6b9f03` 将画布标为自由或场次类型，并允许独立画布和文件引用不带项目。升级前必须先让旧自由画布的生成、检查任务全部结束，再停止 API 和 Worker；检测到旧自由画布有活动任务或占用时，升级在任何 DDL 前拒绝。

升级保留原始记录供显式维护核对，不迁移旧自由画布内容，也不提供旧路由或旧接口兼容。确认数据库备份后，在 `backend` 目录执行：

```bash
uv run python -m app.scripts.retire_project_free_canvases
uv run python -m app.scripts.retire_project_free_canvases --apply
```

第一条只列出旧项目自由画布 ID，第二条在单一事务内清理这些画布、专属运行与保存／检查记录及对应文件引用。遇到活动任务或占用则整批拒绝。文件、通用任务历史、场次画布及其他业务引用保留。清理完成后再启动新 API 与 Worker。

新独立画布没有可恢复的项目归属，本 revision 不支持 downgrade；回退须恢复升级前备份。MySQL DDL 部分失败时先核对实际结构，不盲目重跑。
