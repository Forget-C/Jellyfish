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

### 回归真实 Worker 的启动与审计

审批重启回归可用以下命令独立运行。入口在启动前校验测试库，为本轮分配随机对象前缀，并清除继承的孤儿扫描授权。

```bash
uv run python -m tests.isolated_mysql pytest -q tests/test_canvas_assistant_edit_api.py -k restart
```

新增真实 Worker 进程测试时复用 `tests.worker_process`。专用 MySQL 必须与测试入口指定的连接一致，最终传给子进程的对象前缀必须位于本轮的验证范围。SQLite 测试使用临时目录里的独立数据库，并显式禁用真实 S3。配置不匹配时，入口在运行 Worker 前退出。审批重启用例在同一隔离环境中核对批准结果和原回执重放。

启用[孤儿扫描](../reference/env.md#启用孤儿对象扫描)时，每次成功删除都会在 Worker 日志留下 `orphan_object_deleted` JSON 事件。可按对象键、桶和前缀定位删除，再用 Worker 标识及 UTC 时间对照运行记录。

## 新基线之后的升级与回退

按目标版本核对 `alembic current` 和 `alembic heads`，确认 API 与 Worker 使用预期库。停写并备份后执行正式迁移和种子入口，成功后再启动应用。MySQL DDL 可能部分生效。失败后先核对版本与实际表结构，再按已执行的步骤处理。回退初始 revision 需要恢复备份并使用对应代码。

在 `backend` 目录执行 `uv run alembic revision --autogenerate -m "describe schema change"` 可生成后续 revision 草稿。提交前人工审查 MySQL DDL、约束和已有数据的影响。

## 从 v1.0.0 升级到 v1.1.0

v1.0.0 的数据库版本为 `174afba8895d`。停写并备份后，按上文运行迁移与种子入口；迁移会一步升级到 `a9d237cc18e1`。已完整升级到该版本的数据库再次运行迁移时会直接结束。

回退到 v1.0.0 会移除本次新增的画布助手、审批和会话事件表，以及模型和实验会话上的新增字段。需要保留升级前的数据状态时，恢复备份并启动对应版本的 API 和 Worker。
