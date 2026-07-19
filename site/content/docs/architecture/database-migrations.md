---
title: "数据库迁移与系统种子"
weight: 8
description: "说明 Jellyfish 当前 Alembic 迁移、旧库基线登记和系统提示词种子的执行边界。"
---

> 本文描述当前已生效的数据库初始化实现。

## 执行链路

Compose 与本地联调都使用同一条顺序：

```text
MySQL healthy
→ backend-migrate
→ backend-seed-system-data
→ backend / celery-worker
```

`backend-migrate` 执行 `app.scripts.migrate_database`，使用 `DATABASE_URL` 连接数据库：

- 空数据库执行 `alembic upgrade head`；
- 已有 `alembic_version` 的数据库执行升级到 `head`；
- 没有 Alembic 版本、但全部当前 ORM 表均存在的旧库，先登记到初始 revision，再升级到 `head`；
- 表只存在一部分时终止并列出缺失表，禁止自动登记。

结构变更只通过 `backend/alembic/versions/` 下的 Alembic revision 发布。`Base.metadata.create_all()` 不再作为 Compose 的部署建表机制。

## Alembic 配置

- `backend/alembic.ini` 定义 backend 本地脚本位置；
- `backend/alembic/env.py` 读取应用的 `settings.database_url`；
- `env.py` 显式导入 `app.models`，并使用 `Base.metadata` 支持 revision autogenerate；
- 异步驱动通过 SQLAlchemy 的 `run_sync` 桥接执行 Alembic，因此运行时和迁移共用 `mysql+aiomysql` URL。

常用命令：

```bash
cd backend
uv run alembic current
uv run alembic upgrade head
uv run alembic revision --autogenerate -m "describe schema change"
```

自动生成的 revision 必须人工审查 MySQL DDL、索引、外键和数据兼容性后才能提交。

## 系统种子

`backend-seed-system-data` 在迁移完成后运行 `app.scripts.seed_system_data`：

- 当前只处理系统提示词模板；
- 重复执行保持模板数量稳定；
- 删除操作仅限 `is_system = 1` 的固定系统模板，用户模板不会被删除；
- seed 源数据暂时保留在 `backend/sql/001-init-prompt-template.sql`，它不再被 Compose 按目录扫描执行。

演员设定图迁移会删除 `actor_image_front` / `actor_image_other` 模板及关联的未完成演员图片任务，并写入唯一的 `actor_image` 系统模板。已完成任务的结果文件和已有演员图片关联不受影响。

角色、道具和服装使用同样的迁移规则：清理各自旧的正面/其他视角模板和未完成图片任务，写入单一默认模板；已生成的图片文件和关联保持不变。

旧的结构迁移 SQL (`002`—`008`) 仅作为历史与短期回退资料保留，不参与当前启动链路。
