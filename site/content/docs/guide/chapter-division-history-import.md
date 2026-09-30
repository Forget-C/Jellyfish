---
title: "接入章节划分历史"
weight: 9
description: "升级章节划分版本表，演练并接入旧回执与当前场次基线。"
---

本指南用于已有项目接入章节划分版本。分析任务直接出现在历史列表中；导入命令只处理旧保存回执及实际当前划分，不重新分析，不修改原回执、场次身份或生产成果。

## 升级结构

在维护窗口停止旧版应用写入，并保留升级前数据库备份。在 `backend` 目录运行：

```bash
uv run alembic current
uv run alembic upgrade c3e7f9a1b524
```

本迁移承接 `b2d6e8f0a413`，新增版本快照和当前指向两张表。升级结构不会自动回填；应用与 Worker 应使用包含新契约的同一版本。

## 演练接入

将 `PROJECT_ID` 替换为实际项目身份：

```bash
uv run python -m scripts.import_division_history --project-id PROJECT_ID
```

可加 `--chapter-id CHAPTER_ID` 限定一个章节。默认执行完整校验后回滚，输出 `applied: false`。每章输出：

- `imported`：可接入的完整回执数。
- `skipped`：已有关联版本、无需重复接入的回执数。
- `baseline_created`：是否需要以实际当前成员建立接入基线。
- `issues`：不能完整接入的请求身份及原因，不输出原始正文或任务内部配置。

完整回执保留当时正文、有序成员和创建时间。缺少 AI 来源或身份映射时明确标记未知，不按标题、时间或相似内容猜测。相同时间按请求身份稳定排序；导入后的版本号是本系统分配的编号，不能据此推断未记录的原业务保存顺序。

## 提交与检查

核对演练结果后执行：

```bash
uv run python -m scripts.import_division_history --project-id PROJECT_ID --apply
uv run python -m scripts.import_division_history --project-id PROJECT_ID
```

第二次应不再新增可接入版本或基线；仍不完整的资料继续出现在 `issues`。命令逐章提交，可在中断后重复执行。打开“历史版本”检查：

- 完整旧回执显示为来源“旧记录导入”的版本。
- 无法接入的回执仍显示“旧保存记录”，展开后说明缺失原因，不能载入编辑。
- 只有当前场次、没有完整回执时，显示“接入时当前划分”。新空章节不会因打开页面或运行接入而生成空版本。
- 当前指向以实际成员为准。如果旧回执之后改过名称或顺序，会另建实际基线，不把最新旧回执强行设为当前。
- 已有新版本指向时，导入不会替换它；发现实际成员与其不一致会报错，需排查未记录的写入。

## 回退限制

版本表为空时可回退到前序迁移。已有保存或接入版本时，降级会拒绝执行，避免丢失历史并让旧应用产生未记录写入。需要整体回退时，应恢复经过核对的升级前备份，并处理升级后新增数据；不能只切回旧应用继续写入。

数据边界见[场次工作台架构](/docs/architecture/directing-foundation/)，实施与验收状态见[统一编辑与历史版本计划](/docs/plans/chapter-division-version-editor-plan/)。
