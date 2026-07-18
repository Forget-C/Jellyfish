# Jellyfish AI短剧工厂 / AI Short Drama Studio

<p align="center">
  <img src="./img/logo.svg" alt="Jellyfish Logo" width="160" />
</p>

<p align="center">
  <a href="./README.en.md">English</a> ·
  <a href="./README.ja.md">日本語</a>
</p>

一站式 AI 生成短剧（竖屏短剧 / 微短剧）的生产工具  
从剧本输入 → 智能分镜 → 角色/场景/道具一致性管理 → AI 视频生成 → 后期剪辑 → 一键导出成片

## 📷 项目截图 / Screenshots

| 项目概览 | 资产管理 |
| --- | --- |
| <img src="./img/project.png" alt="项目概览 / Project Overview" width="420" /> | <img src="./img/%E8%B5%84%E4%BA%A7%E7%AE%A1%E7%90%86.png" alt="资产管理 / Asset Management" width="420" /> |

## ✨ 核心价值

- **把短剧生产流程串起来**：从剧本输入、分镜拆解、镜头准备，到图片/视频生成与任务追踪，尽量减少工具切换和流程割裂
- **把 AI 结果变成可确认、可复用的生产资料**：先沉淀为分镜、候选资产、对白、提示词和生成任务，再进入后续制作
- **把“一致性”作为核心问题来处理**：通过角色、场景、道具、服装等实体管理和镜头级关联，尽量降低人物漂移和场景跑偏
- **把长耗时生成变成可追踪的任务系统**：统一管理文本处理、图片生成、视频生成等异步任务，支持状态可见、可取消、可恢复
- **把 AI 能力接入做成基础设施**：通过模型管理、提示词模板、OpenAPI 协作和任务执行体系，为后续扩展更多工作流留出空间

## ✨ 核心能力

Jellyfish 不是单点的“AI 出图 / AI 出视频”工具，而是一套面向短剧生产的工作台。  
它围绕“剧本理解、分镜准备、资产一致性、生成执行、任务追踪”构建了一条可落地的主流程。

### 1. AI 剧本理解与分镜拆解

支持将章节剧本交给 AI 进行结构化处理，形成后续制作可用的分镜基础数据，包括：

- 剧本拆分为镜头
- 角色 / 场景 / 道具 / 服装等要素提取
- 对白提取与整理
- 剧本优化、简化与一致性检查
- 角色画像、场景信息、道具信息等专项分析

### 2. 分镜准备与确认工作流

当前主流程是：

`剧本拆分 → 分镜准备 → 候选确认 → 镜头 ready → 进入生成工作台`

在准备阶段，支持：

- 提取并刷新镜头候选信息
- 确认或忽略资产候选
- 接受或忽略对白候选
- 关联已有角色 / 场景 / 道具 / 服装
- 对单镜头基础信息进行修正
- 用统一状态判断镜头是否完成准备

### 3. 资产一致性与复用体系

围绕短剧生产中的一致性问题，项目提供统一实体管理能力，覆盖角色、演员、场景、道具和服装。  
支持实体库管理、镜头级关联、图片管理和复用，尽量减少跨镜头生成时的内容漂移。

### 4. 镜头级图片与视频生成编排

在镜头进入 `ready` 后，可继续进入生成工作台完成生成准备与执行，包括：

- 关键帧与参考图管理
- 镜头级视频提示词预览
- 图片 / 视频生成任务发起
- 单镜头与批量生成前检查
- 生成结果回流到镜头与素材体系

### 5. 统一任务中心与异步执行能力

当前支持：

- 文本处理任务异步执行
- 图片 / 视频任务异步执行
- 任务状态、结果、耗时统一追踪
- 取消任务
- 全局任务中心查看运行中与最近完成任务
- 从任务回到对应项目 / 章节 / 镜头上下文

### 6. 模型、提示词与生成基础设施

项目还提供支撑 AI 生产的基础设施能力，包括：

- 多 Provider / 多模型管理
- 模型分类与默认模型设置
- 提示词模板管理
- 文件与生成素材管理
- OpenAPI 驱动的前后端接口协作

## 🚀 主要功能一览

### 项目与章节管理

- 创建和管理项目、章节
- 以章节为单位承载剧本、分镜与生成流程
- 提供基础统计与工作台入口

### AI 剧本处理

- 将章节剧本拆分为多个镜头
- 提取角色、场景、道具、服装与对白信息
- 支持剧本优化、简化与一致性检查
- 支持角色画像、场景信息、道具信息等专项分析

### 分镜准备工作流

- 编辑镜头标题、摘要和基础信息
- 提取并刷新资产/对白候选
- 确认、忽略或关联候选项
- 通过统一准备态判断镜头是否完成确认
- 明确区分“准备完成”和“生成中”

### 资产与实体管理

- 管理角色、演员、场景、道具、服装等实体
- 支持镜头级关联与复用
- 支持实体图片管理
- 支持名称存在性检查，辅助复用已有资产

### 镜头生成工作台

- 管理关键帧、参考图与视频提示词
- 检查镜头视频生成准备度
- 发起图片 / 视频生成任务
- 支持单镜头和批量推进生成流程

### 任务中心

- 统一查看运行中与最近完成的任务
- 跟踪任务状态、进度、耗时与结果
- 支持取消任务
- 支持从任务快速回到对应项目、章节或镜头

### 模型与提示词基础设施

- 管理 Provider、Model 与默认模型设置
- 管理图片、视频、分镜等提示词模板
- 通过 OpenAPI 生成前端请求与类型
- 为后续扩展更多 AI 工作流提供统一底座

### 文件与素材管理

- 管理上传文件与生成产物
- 统一预览、关联和复用图片/视频素材
- 为镜头和实体提供可回溯的素材支撑

## 🎯 适用场景

- 短剧/微短剧内容创作者
- AI 影视工作室批量生产
- 个人创作者想低成本试水竖屏短剧
- 教育/培训机构制作教学短视频
- 品牌/电商制作带剧情的产品宣传短片

## 🛠 技术栈（示例）

- 前端：React 18 + TypeScript + Vite + Ant Design / Tailwind CSS
- 状态管理：Redux Toolkit / Zustand
- 工作流编辑：React Flow
- 视频播放器：Video.js / Plyr
- 富文本/代码编辑：Monaco Editor / React Quill
- 后端（可选开源部分）：Node.js / NestJS / FastAPI / Spring Boot
- AI 生成层：对接多种大模型 API（OpenAI / Anthropic / Midjourney / Runway / Kling / Luma 等）

## 🔁 前端 OpenAPI 请求/类型生成与更新

前端请求函数与数据结构由后端 OpenAPI 文档生成，生成目录为 `front/src/services/generated/`，OpenAPI 文档缓存为 `front/openapi.json`。

在后端开发服务已启动（默认 `http://127.0.0.1:8000`）时，在前端目录执行：

```bash
cd front
pnpm run openapi:update
```

## 🐳 Docker 一键启动（MySQL + Redis + RustFS + Backend + Celery Worker + Front）

项目已提供开箱即用的 compose 编排，文件位于 `deploy/compose/`。

### 端口

- 前端：`http://localhost:7788`
- 后端：`http://localhost:8000`（`/docs` 为 Swagger）
- MySQL：`localhost:${MYSQL_PORT:-3306}`
- Redis：`localhost:${REDIS_PORT:-6379}`
- RustFS（S3 API）：`http://localhost:${RUSTFS_PORT:-9000}`（Console：`http://localhost:${RUSTFS_CONSOLE_PORT:-9001}`）

### 启动

```bash
cp deploy/compose/.env.example deploy/compose/.env
docker compose --env-file deploy/compose/.env -f deploy/compose/docker-compose.yml up --build
```

## 🧑‍💻 开发环境启动（前后端分离）

如需本地启动前后端、复用 Docker Compose 拉起的中间件，先复制配套环境变量，并启动 MySQL、Redis、RustFS、数据库迁移和系统种子任务：

```bash
cp deploy/compose/.env.example deploy/compose/.env
cp backend/.env.example backend/.env
cp front/.env.example front/.env
docker compose --env-file deploy/compose/.env -f deploy/compose/docker-compose.yml \
  up -d mysql redis rustfs backend-migrate backend-seed-system-data
```

`backend/.env.example` 中的默认 MySQL 与 RustFS 凭据已和 `deploy/compose/.env.example` 对齐。如修改 Compose 的对应凭据，也请同步修改本地的 `backend/.env`。

### 启动后端

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 启动前端

```bash
cd front
pnpm install
pnpm dev
```

## 📄 开源协议 / License

本项目采用 [Apache-2.0](../LICENSE) 开源协议。

## 💬 交流与反馈 / Community

- **[GitHub Issues](https://github.com/Forget-C/Jellyfish/issues)** — 功能建议、Bug 反馈、使用讨论
