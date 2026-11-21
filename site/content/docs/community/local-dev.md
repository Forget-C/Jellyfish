---
title: "开发快速开始"
weight: 1
description: "启动本地 API、Worker 和前端，完成基本联调。"
url: "/docs/getting-started/local-dev/"
---

## 准备环境

在 macOS 或 Linux 上准备 Docker Compose、uv、Python、Node.js 与 pnpm。从仓库根目录复制样例配置（首次设置时），启动本地联调需要的中间件和初始化任务。

```bash
cp deploy/compose/.env.example deploy/compose/.env
cp backend/.env.example backend/.env
cp front/.env.example front/.env
docker compose --env-file deploy/compose/.env -f deploy/compose/docker-compose.yml \
  up --build -d mysql rustfs backend-migrate backend-seed-system-data
```

数据库迁移和系统种子任务成功退出后，在三个终端分别从仓库根目录运行以下命令。

**API**

```bash
cd backend
uv sync
uv run python -m app.dev api
```

**Worker**

```bash
cd backend
uv run python -m app.dev worker
```

同一数据库运行一个 Worker。

**前端**

```bash
cd front
pnpm install
pnpm dev
```

## 检查与继续阅读

打开 [Vite 前端](http://localhost:5173)，确认项目列表能加载，并检查 [API 健康状态](http://localhost:8000/health)。在后端目录运行 `uv run python -m app.dev status` 可核对 API 和 Worker，在仓库根目录运行 `pnpm --dir front run typecheck` 可做前端基础检查。

版本要求、端口调整、排查和接口同步见[本地开发指南](https://github.com/Forget-C/Jellyfish/blob/main/docs/development/guides/local-development.md)；其他工程文档见[仓库开发文档](https://github.com/Forget-C/Jellyfish/blob/main/docs/development/README.md)。
