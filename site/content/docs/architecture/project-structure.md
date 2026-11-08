---
title: "项目结构"
weight: 1
description: "快速理解 Jellyfish 当前真实生效的顶层目录与主业务链路。"
---

> 本文属于“当前架构”文档，描述的是当前项目的真实目录结构与职责分层。

## 顶层目录

```text
jellyfish/
├── backend/    # FastAPI、服务层、模型层、AI 工作流
├── front/      # React + Vite 前端工作台
├── deploy/     # Docker 与 Compose 配置
├── docs/       # 仓库内文档与图片素材
└── site/       # Hugo 官网与文档站
```

## 主业务链路

```text
项目 -> 章节原文 -> 场次 -> 设计 / 生产单元 / 指令 -> Take -> 剪辑 / 交付 / 导出
```

## 前端职责

- 承接 Studio 工作台页面
- 使用 OpenAPI 生成客户端与后端协作
- 管理项目、章节、分镜、资产、模型与 Agent 相关 UI

## 后端职责

- 提供 `studio / llm / film / script-processing` 等 API
- 管理数据库模型、文件存储与任务状态
- 通过 `chains / services / core.tasks` 接入 AI 能力

## 生成能力分层约束

- 通用生成契约（输入/输出 DTO、供应商配置等）统一放在 `app/core/contracts`。
- `app/core/tasks` 仅保留任务封装、分派与执行编排，不定义跨层 DTO。
- `app/core/integrations` 仅实现供应商协议适配，依赖 `contracts`，不依赖 `tasks` 类型模块。

## 站点职责

- 官网首页与产品介绍
- 安装、开发、部署与贡献文档
- 维护已发布版本的发布说明与更新公告

## 推荐阅读路径

1. 先看 [前端说明](/docs/guide/frontend/)
2. 再看 [后端说明](/docs/guide/backend/)
3. 最后看 [AI 工作流](/docs/guide/ai-workflow/)
