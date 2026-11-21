---
title: "启动并检查服务"
weight: 2
description: "通过 Docker Compose 启动应用和配套服务。"
---

## 配置并启动

先[获取项目](../installation/)。从仓库根目录复制配置模板。重复部署时检查已有配置和模板差异，保留本地设置。

```bash
cp deploy/compose/.env.example deploy/compose/.env
```

在该文件中填写数据库和对象存储的凭据，并确保宿主机端口可用。样例凭据适用于本地演示，请在正式部署前更换。默认前端和 API 地址适用于从这台机器访问。

```bash
docker compose --env-file deploy/compose/.env -f deploy/compose/docker-compose.yml up --build -d
docker compose --env-file deploy/compose/.env -f deploy/compose/docker-compose.yml ps -a
```

Compose 启动前端、后端、任务 Worker、MySQL 和 RustFS。数据库迁移与系统提示词模板初始化任务成功退出后，后端和 Worker 才会启动。

## 检查是否可用

- 打开 [Jellyfish](http://localhost:7788)，从顶部进入「项目」，确认列表正常加载。
- 访问[后端健康检查](http://localhost:8000/health)，确认响应包含 `"data":{"status":"ok"}`。
- 需要检查对象存储时，打开 [RustFS 控制台](http://localhost:9001)。
- 若迁移或初始化任务失败，用同一 Compose 配置执行 `logs backend-migrate backend-seed-system-data` 查看原因，修正配置后再启动。数据库与媒体保存在持久卷中，请保留这些卷。

[![刚启动的工作台：项目列表显示新建项目按钮及空列表](../../../images/docs/setup/first-project-list.webp)](../../../images/docs/setup/first-project-list.webp)

这是首次启动的隔离部署。「暂无项目」和「新建项目」同时可见即可继续；已有项目的部署会显示其项目列表。

升级已有部署前先备份数据库，核对现有版本及回退方式。维护步骤见[数据库升级与回退](https://github.com/Forget-C/Jellyfish/blob/main/docs/development/guides/database-upgrade.md)。

服务正常后，继续[配置生成模型]({{< relref "model-setup" >}})，或[先创建一个项目]({{< relref "/docs/guide/first-project" >}})。
