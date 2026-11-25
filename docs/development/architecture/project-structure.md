# 项目结构

## 顶层目录

```text
jellyfish/
├── backend/    # FastAPI、服务层、模型层、AI 工作流
├── front/      # React + Vite 前端工作台
├── deploy/     # Docker 与 Compose 配置
├── docs/       # 开发文档、技能项目配置及图片素材
└── site/       # Hugo 官网、产品文档与简短开发入口
```

## 主业务链路

```text
场次分镜：项目 -> 章节原文 -> 场次 -> 分镜画布 -> 画布运行与结果
生产计划：固定计划修订 -> 拍摄任务 -> Take -> 剪辑修订
```

## 前端职责

- 承接 Studio 工作台页面
- 使用 OpenAPI 生成客户端与后端协作
- 管理项目、章节、场次、资产、生成画布、模型与 Agent 相关界面

## 后端职责

- 提供 `studio / llm / film / script-processing` 等 API
- 管理数据库模型、文件存储与任务状态
- 通过 `chains` 和业务服务组织 AI 能力，由独立 Worker 推进后台任务

## 生成能力分层约束

- 通用生成契约（输入/输出 DTO、供应商配置等）统一放在 `app/core/contracts`。
- `app/core/integrations` 实现供应商协议适配并依赖公共契约。生成提交、执行输入准备及业务交付由生成服务承接。

## 站点职责

- 官网首页与产品介绍
- 应用安装部署、产品使用说明与简短开发入口
- 维护已发布版本的发布说明与更新公告

## 推荐阅读路径

1. 先看 [前端说明](../guides/frontend.md)
2. 再看 [后端说明](../guides/backend.md)
3. 最后看 [AI 工作流](ai-workflow.md)
