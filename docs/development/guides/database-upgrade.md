# 数据库升级与回退

## 从空库开始

供应商配置版本 `174afba8895d` 要求升级前的 `providers` 表为空。已有配置时迁移会中止并保留数据；初始版本请使用新的空库部署。

使用空的 MySQL 库配置当前版本的 `DATABASE_URL`。此基线从空库建立系统表，不导入旧环境的配置和业务数据。旧数据库继续由对应版本的代码管理。数据库非空且没有 Alembic 版本记录时，迁移入口会拒绝执行。遇到版本缺失或表结构不匹配时，先核对目标库和代码版本。

Compose 依次启动 MySQL、迁移、系统种子，再启动 API 和 Worker。使用自行提供的 MySQL 时，在 `backend` 目录执行：

```bash
uv run python -m app.scripts.migrate_database
uv run python -m app.scripts.seed_system_data
uv run alembic current
```

核对当前 revision 与 `uv run alembic heads` 输出一致，并按[本地开发指南](local-development.md)启动 API 和独立 Worker，检查健康接口和 Worker 日志。种子初始化全局设置和四条系统模板，详见[系统种子](../architecture/database-migrations.md#系统种子)。供应商、模型及所需凭据通过新环境的管理入口配置。

## 在专用 MySQL 核对基线

创建单独的空测试库，设置 `JELLYFISH_TEST_MYSQL_URL` 指向该库。库名以 `jellyfish_check_` 开头。需要执行场次 MySQL 用例时，使用 `jellyfish_check_directing` 前缀。校验入口在连接前检查目标配置，并把迁移、种子与测试进程统一指向该测试库。在 `backend` 目录运行：

```bash
uv run python -m tests.isolated_mysql migrate
uv run python -m tests.isolated_mysql seed
uv run python -m tests.isolated_mysql pytest -q \
  'tests/test_database_baseline_business.py::test_new_project_reads_current_canvas_assets_and_production[mysql]' \
  tests/services/test_task_mysql.py tests/directing/test_mysql.py
```

重复执行迁移和种子应保持唯一的版本记录、全局设置和内置模板数量。业务用例通过 API 创建本轮数据，使用模型与对象存储替身，实际运行 Worker；再次执行整组用例时使用专用空库。

## 新基线之后的升级与回退

按目标版本核对 `alembic current` 和 `alembic heads`，确认 API 与 Worker 使用预期库。停写并备份后执行正式迁移和种子入口，成功后再启动应用。MySQL DDL 可能部分生效。失败后先核对版本与实际表结构，再按已执行的步骤处理。回退初始 revision 需要恢复备份并使用对应代码。

在 `backend` 目录执行 `uv run alembic revision --autogenerate -m "describe schema change"` 可生成后续 revision 草稿。提交前人工审查 MySQL DDL、约束和已有数据的影响。


## 画布助手审批切换

从旧审批版本升级时，在执行 `d6bf47c2a901` 前停止旧 API、独立 Worker 和其他写入此库的旧进程，等待在途请求结束，再备份并执行正式迁移。迁移完成且 `alembic current` 与目标代码的唯一 head 一致后，启动同版 API 和 Worker。

切换会永久失效旧的待审提案与冲突检查点。旧页面应刷新并重新发起，回退 schema 不会恢复这些状态。如需恢复切换前的状态，使用升级前备份和匹配的旧代码。已生效的画布改动及普通对话保留。已受理或受理结果未知的媒体任务保留原请求和任务标识，确认过的终态失败继续显示失败。不要重新提交结果未知的任务来验证升级。

使用隔离库验收时，核对旧卡再次确认会提示失效、已写入差异仍存在，以及原生成任务和回执可查。新预演需要经过送审和确认才可写入，可用可控模型核对审批恢复。
