---
title: "本地开发"
weight: 2
description: "启动前后端并完成本地联调。"
---

## 启动后端

```bash
cd backend
cp .env.example .env
uv sync
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## 启动任务 Worker

在另一个终端中启动独立任务进程：

```bash
cd backend
uv run python -m app.task_worker
```

`uvicorn --reload` 只重载 API 进程，不重载 Worker。修改任务执行、模型输出解析或生成校验代码后，确认没有排队或运行中的任务，再停止并重新启动 Worker；同一数据库只运行一个调度 Worker。否则可能出现旧 Worker 将结果标为成功，而新 API 在应用时拒绝结果的情况。重启不会重写已完成任务的结果。

## 启动前端

```bash
cd front
pnpm install
pnpm dev
```

## 默认端口

- 前端：`http://localhost:7788`
- 后端：`http://localhost:8000`
- Swagger：`http://localhost:8000/docs`

## OpenAPI 更新

```bash
cd front
pnpm run openapi:update
```

## 官网与文档站本地预览

```bash
cd site
hugo mod tidy
hugo server --buildDrafts --disableFastRender
```

## 推荐的联调顺序

1. 启动后端，确认 `/docs` 和 `/health` 正常。
2. 启动前端，确认页面能访问并能请求后端。
3. 如果修改了接口定义，再执行 `openapi:update`。
4. 如果同时在维护官网，再单独启动 `site/` 预览。
