---
title: "Alembic 统一数据库迁移方案"
description: "将当前 ORM 建表与手写 SQL 初始化收敛为 Alembic 结构迁移和独立系统种子流程的实施计划。"
weight: 9
---

> 本文属于“任务计划”文档。Alembic 初始 schema、旧库安全登记、Compose 迁移服务和系统 seed 服务已落地；历史数据 reconciliation、seed 数据包收敛与遗留文件移除仍在推进。

## 当前实施状态

已完成：

- `backend/alembic/` 异步 Alembic 配置与初始 schema revision；
- 空库 `upgrade head`、完整旧库安全 baseline/stamp、残缺 schema 拒绝登记；
- Compose 的 `backend-migrate` 与 `backend-seed-system-data` 一次性服务；
- 默认提示词 seed 独立于 schema 创建执行，并限制删除范围为系统模板。

待完成：

- 将提示词 seed 从遗留 SQL 文件收敛为版本化数据包与显式 upsert；
- 在完成一个发布周期验证后删除 `init_db.py` 与 `backend/sql/002`—`008`。

## 目标

将当前两套数据库初始化机制收敛为一条可审计、可升级的链路：

```text
MySQL ready
→ Alembic upgrade head（结构与受控数据迁移）
→ system seed（默认提示词等系统数据）
→ backend / celery-worker 启动
```

完成后，以下职责必须清晰分离：

| 类别 | 唯一入口 | 说明 |
| --- | --- | --- |
| 表、列、索引、约束 | Alembic revision | 版本化、顺序执行、记录在 `alembic_version`。 |
| 既有数据修正 | Alembic revision | 与触发该修正的结构变更同一 revision，必须可重复评审。 |
| 默认提示词等系统数据 | 独立 seed 命令 | 可幂等重复运行，不依赖建表流程。 |
| 业务数据 | API / service | 不在启动初始化脚本中改写。 |

不再保留以下运行时路径：

- `init_db.py` 调用 `Base.metadata.create_all()` 作为部署建表手段；
- 启动时遍历执行 `backend/sql/*.sql`；
- 依赖文件名排序表达迁移顺序。

## 改造前现状与问题

改造前 Compose 的顺序是：

```text
mysql
→ backend-init-db: Base.metadata.create_all()
→ mysql-init-sql: 顺序执行 001...008 SQL
→ backend / celery-worker
```

两者并不完全重复：

- `backend-init-db` 创建当前 ORM 中缺失的基础结构，但不会修改已有列、索引和历史数据。
- `mysql-init-sql` 包含增量列/表变更、历史状态回填、模型默认值迁移，以及默认提示词写入。

但它们在新库的结构创建上重叠，且手写 SQL 没有已执行版本记录。部分脚本只能依赖“存在则跳过”来规避重复执行；`001-init-prompt-template.sql` 还会删除固定 ID 的提示词，启动副作用不透明。

## 目标架构

### Alembic 布局

在 `backend/` 下新增：

```text
alembic.ini
alembic/
├── env.py
├── script.py.mako
└── versions/
    ├── 0001_initial_schema.py
    ├── 0002_legacy_data_reconciliation.py
    └── ...
app/
└── scripts/
    └── seed_system_data.py
```

`alembic/env.py` 必须：

1. 从 `app.config.settings.database_url` 获取连接串，沿用后端 `.env` 与 Compose 的 `DATABASE_URL`。
2. 显式导入 `app.models`，再以 `Base.metadata` 作为 `target_metadata`，保证所有模型均已注册。
3. 使用 SQLAlchemy 异步引擎的 `run_sync` 执行 Alembic 操作，继续使用现有 `mysql+aiomysql` 驱动，不额外引入第二套 MySQL URL。
4. 默认拒绝 SQLite 以外的非预期数据库方言，或在命令启动时清晰报错；生产目标先限定为 MySQL。

后端依赖新增 `alembic`，并锁定到 `uv.lock`。迁移命令统一从 `backend/` 执行：

```bash
uv run alembic upgrade head
uv run alembic current
uv run alembic revision --autogenerate -m "add example field"
```

## 初始基线与既有库迁移

这是本次改造的关键，不能直接对已有数据库执行自动生成的 `0001_initial_schema`。

### 新建数据库

1. 创建 `0001_initial_schema`，内容以当前 ORM 的完整 MySQL 结构为准。
2. 人工审查自动生成的表、索引、外键、枚举/检查约束，禁止直接接受未审查的 autogenerate 结果。
3. 执行 `alembic upgrade head`，再执行 system seed。

### 已有 Compose 卷或线上数据库

增加一次性的“旧库基线”命令，而不是直接 `stamp head`：

```text
旧库备份
→ 运行当前版本最后一次 legacy SQL 初始化
→ 结构完整性预检
→ alembic stamp 0001_initial_schema
→ alembic upgrade head
→ system seed
```

预检至少校验：

- 全部 ORM 表存在；
- 现有 `002`—`008` 涉及的列、索引、约束已存在；
- `model_settings` 与 `prompt_templates` 的基础数据满足当前代码读取条件；
- 数据库字符集为 `utf8mb4`。

预检失败必须退出并输出缺失项，严禁自动 `stamp`。`stamp` 只写版本号，不执行 DDL，错误使用会使真实 schema 与迁移历史永久脱节。

迁移切换版本发布后，保留旧初始化容器一个发布周期作为回退路径；确认所有目标环境都已记录 Alembic 版本后再删除 `backend/sql/`、`init_db.py` 和旧容器定义。

## 历史 SQL 的归属

| 现有内容 | 收敛方式 |
| --- | --- |
| `001-init-prompt-template.sql` | 移至独立 seed 数据包，不作为 schema migration。 |
| `002`、`004`、`005`、`007`、`008` 的结构变更 | 在初始 schema 中体现当前最终结构；对旧库仅在基线预检通过后 stamp，不重复执行。 |
| `003` 的 `shot.status` 回填 | 作为 `0002_legacy_data_reconciliation` 的一次性数据迁移，记录执行版本。 |
| `006` 的模型默认值迁移 | 作为 `0002_legacy_data_reconciliation` 的一次性数据迁移，记录执行版本。 |

新 revision 的规则：

- 一项结构变更及其必要的数据回填放在同一个 revision；
- `upgrade()` 与 `downgrade()` 必须写明可逆性；不可安全回滚的数据迁移要明确抛出说明，而不是伪造删除操作；
- 自动生成仅用于发现 metadata 差异，提交前必须人工检查 MySQL DDL、数据兼容性和锁表风险；
- 不修改已发布 revision，修复通过新 revision 追加。

## 系统种子策略

新增 `seed_system_data` 命令，负责默认 `prompt_templates` 等系统级初始数据。

要求：

- 使用确定性业务键（例如系统模板 ID 或 `category + name`）执行 upsert；
- 只更新明确标识为系统维护的数据，不删除用户创建的模板；
- 输出新增、更新、跳过数量，支持 `--dry-run`；
- 可安全重复执行，且不依赖数据库是否为空；
- 业务数据修复不放入 seed。

Compose 增加一个 `backend-seed-system-data` 一次性服务，依赖迁移成功；它完成后，`backend` 与 `celery-worker` 才允许启动。

## Compose 与本地开发改造

目标 Compose 依赖图：

```text
mysql healthy
├─→ backend-migrate completed successfully
│   └─→ backend-seed-system-data completed successfully
│       ├─→ backend
│       └─→ celery-worker
└─→ redis healthy
```

改动项：

1. 用 `backend-migrate` 替换 `backend-init-db`，命令固定为 `uv run alembic upgrade head`。
2. 用 `backend-seed-system-data` 替换 `mysql-init-sql`，命令固定为系统 seed 脚本。
3. `backend`、`celery-worker` 仅依赖迁移和 seed 成功，不再各自携带初始化逻辑。
4. 本地联调启动命令同步改为：先拉起 MySQL/Redis/RustFS，再执行 Alembic 与 seed，最后启动本地后端和前端。

## 分阶段实施

### 阶段 1：基础设施与基线

- 引入 Alembic、配置异步 `env.py` 和 metadata 导入。
- 生成并人工审查 `0001_initial_schema`。
- 编写新库 `upgrade head` 集成测试。
- 编写旧库预检与显式 baseline/stamp 命令。

### 阶段 2：数据迁移与种子拆分（进行中）

- `003`、`006` 的历史数据逻辑已迁入受控 revision。
- 实现幂等 system seed，覆盖当前默认提示词。
- 为 seed 编写空库、重复执行、保留用户数据测试。

### 阶段 3：Compose 切换

- 引入 `backend-migrate`、`backend-seed-system-data`。
- 在全新卷和旧库副本上分别验证启动链路。
- 更新开发与部署文档，明确 `alembic current` 排障方式。

### 阶段 4：移除遗留机制

- 完成一个发布周期观察和所有目标环境版本盘点。
- 删除 `init_db.py`、`backend/sql/`、`backend-init-db`、`mysql-init-sql`。
- 更新 architecture 文档，记录最终迁移与种子职责。

## 验收与回滚

### 验收命令

```bash
cd backend
uv run alembic upgrade head
uv run alembic current
uv run alembic check
uv run pytest tests -q
docker compose --env-file deploy/compose/.env -f deploy/compose/docker-compose.yml up --build
```

还必须覆盖：

- 空 MySQL 卷可完成迁移、seed、后端和 Celery 启动；
- 旧库副本通过预检并完成基线登记；
- 重启 Compose 不重复执行已完成的 revision；
- system seed 重复执行不会删除用户数据；
- 迁移失败时后端与 worker 不启动。

### 回滚原则

- 上线前必须备份数据库；生产回滚优先恢复备份或部署前一版本，不将 `downgrade` 视作所有数据迁移的通用回滚方案。
- 删除列、收缩约束等破坏性操作采用 expand/contract 两阶段发布，确保旧应用版本仍可运行。
- 在遗留初始化容器删除前，保留其镜像和切换说明，作为短期应急回退路径。

## 完成定义

- 所有 schema 变更只通过 Alembic revision 发布；
- Compose 中不存在 `create_all()` 或按目录扫描 SQL 的启动服务；
- 默认系统数据由独立、幂等 seed 管理；
- 新库与旧库均有可验证的升级路径；
- 开发、部署、架构文档与真实实现一致。
