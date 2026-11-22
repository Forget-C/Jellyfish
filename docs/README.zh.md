# Jellyfish — AI 短剧工作台

<p align="center">
  <img src="img/logo.svg" alt="Jellyfish Logo" width="160" />
</p>

<p align="center">
  <a href="https://www.apache.org/licenses/LICENSE-2.0">
    <img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License" />
  </a>
  <a href="https://img.shields.io/badge/frontend-React%20%2B%20Vite-61DAFB">
    <img src="https://img.shields.io/badge/frontend-React%20%2B%20Vite-61DAFB" alt="Frontend" />
  </a>
  <a href="https://img.shields.io/badge/backend-FastAPI-009688">
    <img src="https://img.shields.io/badge/backend-FastAPI-009688" alt="Backend" />
  </a>
  <a href="https://github.com/Forget-C/Jellyfish/actions/workflows/deploy-site.yml">
    <img src="https://github.com/Forget-C/Jellyfish/actions/workflows/deploy-site.yml/badge.svg" alt="Deploy Site" />
  </a>
  <a href="https://github.com/Forget-C/Jellyfish/actions/workflows/ghcr-images.yml">
    <img src="https://github.com/Forget-C/Jellyfish/actions/workflows/ghcr-images.yml/badge.svg" alt="Build and push images" />
  </a>
</p>

<p align="center">
  <a href="README.en.md">English</a> ·
  <a href="README.zh.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a>
</p>

面向 AI 短剧创作的制作工作台。从章节原文划分场次，准备视觉参考，再到分镜画布生成候选画面。界面支持中文和英文，默认中文。

[快速启动](#-docker-compose) · [本地开发](development/guides/local-development.md)

## 📷 项目截图

<a href="../site/static/images/screenshots/home/storyboard.webp"><img src="../site/static/images/screenshots/home/storyboard.webp" alt="在分镜画布中查看这一镜" width="720" /></a>

**这一镜是怎样生成的**　《雾海来信》的分镜画布把镜头描述和人物、站台、旧信封三张参考图接入图片模型。创作者从候选画面中选定首帧，试拍了一段慢推镜。

[查看选定首帧](../site/static/images/docs/labs/letter-frame.jpg) · [▶ 观看 3 秒试拍（本地演示）](../site/static/images/sea-letter/letter-push-in.mp4)

<details>
<summary>场次参考与工作台截图</summary>

| 林夏 | 海边站台 | 旧信封 |
| --- | --- | --- |
| <a href="../site/static/images/docs/assets/samples/character.jpg"><img src="../site/static/images/docs/assets/samples/character.jpg" alt="林夏" width="180" /></a> | <a href="../site/static/images/docs/assets/samples/scene.jpg"><img src="../site/static/images/docs/assets/samples/scene.jpg" alt="海边站台" width="180" /></a> | <a href="../site/static/images/docs/assets/samples/prop.jpg"><img src="../site/static/images/docs/assets/samples/prop.jpg" alt="旧信封" width="180" /></a> |

| 章节划分 | 场次参考 |
| --- | --- |
| <a href="../site/static/images/screenshots/home/scene-division.webp"><img src="../site/static/images/screenshots/home/scene-division.webp" alt="章节划分" width="320" /></a> | <a href="../site/static/images/screenshots/home/object-references.webp"><img src="../site/static/images/screenshots/home/object-references.webp" alt="场次参考" width="320" /></a> |

</details>

## ✨ 核心价值

- 每个场次都能对照它改编的原文片段。
- 跨镜头复用角色、场所和道具参考，保持视觉一致。
- 选择候选画面前，可以核对生成所用的输入和结果。

## ✨ 核心能力

### 1. AI 剧本理解与分镜拆解

保存章节原文，标记场次边界，再为选定场次生成并编辑分镜。

### 2. 镜头准备与确认流程

章节原文 → 场次划分 → 选用参考 → 分镜画布 → 生成预检 → 查看候选画面。

### 3. 资产一致性与复用

将角色、场所、道具和服装与项目资产关联，为每个场次选用所需参考图。

### 4. 镜头级图像与视频生成

在画布中把镜头描述和参考素材接入模型卡，预检输入并查看生成的图像或视频。

### 5. 统一异步任务中心

跟踪文本、图像和视频任务，查看失败原因，取消支持取消的任务。

### 6. 模型、提示词与生成服务

配置服务商和默认模型，管理提示词模板，通过 OpenAPI 接口访问后端。

## 🚀 功能概览

### 项目与章节管理

创建项目，保存章节原文，查看历史划分方案。

### AI 剧本处理

在文本实验室中试写对白、角色动作和镜头描述。

### 镜头准备流程

对照原文和场次参考，逐镜调整描述。

### 资产与实体管理

维护项目资产，选择场次实际采用的参考图。

### 镜头生成工作区

编辑提示词和模型参数，执行预检，预览候选结果。

### 任务中心

查看执行进度，打开任务核对结果。

### 模型与提示词管理

为不同生成任务选择默认模型，维护可复用的提示词模板。

### 文件与媒体管理

预览上传文件和生成媒体，并将其用作参考素材。

## 🎯 适用场景

- 短剧团队协作准备分镜、评审候选画面。
- 独立创作者为同一场戏尝试不同的镜头表达。
- 教育、品牌和电商团队把脚本制作成短视频。

## 🔁 前端 OpenAPI 客户端与类型生成

在 `http://127.0.0.1:8000` 启动当前版本的后端后，从仓库根目录运行以下命令，更新 `front/openapi.json` 和 `front/src/services/generated/`。

```bash
pnpm --dir front run openapi:update
```

## 🐳 Docker Compose

### 端口

- 前端: `http://localhost:7788`
- API: `http://localhost:8000` (Swagger UI: `/docs`)
- MySQL: `localhost:${MYSQL_PORT:-3306}`
- RustFS: `http://localhost:${RUSTFS_PORT:-9000}`

### 启动

首次配置时，在仓库根目录创建环境文件，然后启动服务。

```bash
cp deploy/compose/.env.example deploy/compose/.env
docker compose --env-file deploy/compose/.env -f deploy/compose/docker-compose.yml up --build
```

打开前端后，先[创建第一个项目](../site/content/docs/guide/first-project.md)。生成媒体前，请先[配置模型](../site/content/docs/getting-started/model-setup.md)。

## 🧑‍💻 本地开发

参照[本地开发指南](development/guides/local-development.md)启动 API、任务工作进程和 Vite 前端。架构与规范见[开发文档](development/README.md)，官网维护见[站点指南](../site/README.md)。

## 📄 许可证

本项目使用 [Apache-2.0](../LICENSE) 许可证。

## 💬 社区与反馈

- [GitHub Issues](https://github.com/Forget-C/Jellyfish/issues)
