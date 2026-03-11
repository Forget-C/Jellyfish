# Jellyfish AI短剧工厂 / AI Short Drama Studio

<p align="center">
  <img src="./docs/img/logo.svg" alt="Jellyfish Logo" width="160" />
</p>

<p align="center">
  <a href="./README.md">简体中文</a> ·
  <a href="./docs/README.en.md">English</a>
</p>

一站式 AI 生成短剧（竖屏短剧 / 微短剧）的生产工具  
从剧本输入 → 智能分镜 → 角色/场景/道具一致性管理 → AI 视频生成 → 后期剪辑 → 一键导出成片

## 📷 项目截图 / Screenshots

| 项目概览 | 资产管理 |
| --- | --- |
| <img src="./docs/img/project.png" alt="项目概览 / Project Overview" width="420" /> | <img src="./docs/img/%E8%B5%84%E4%BA%A7%E7%AE%A1%E7%90%86.png" alt="资产管理 / Asset Management" width="420" /> |

## ✨ 核心价值

- **极致一致性**：全局种子 + 统一风格 + 资产复用，解决 AI 生成最痛的“人物/场景漂移”问题
- **工业化生产流程**：从文学剧本到可拍摄分镜，再到视频片段，一条龙闭环
- **可视化 & 可控**：所见即所得的分镜编辑器 + 精细的镜头语言控制 + 实时预览
- **资产复用体系**：角色/场景/道具/服装/提示词模板全生命周期管理

## 🚀 主要功能一览

| 模块               | 核心功能                                                                 | 亮点特性                                      |
|--------------------|--------------------------------------------------------------------------|-----------------------------------------------|
| 项目管理           | 创建项目、全局风格/种子统一控制、项目仪表盘、章节统计                   | 全局种子防漂移、风格强制继承                  |
| 章节拍摄工作台     | 剧本输入 → 智能精简 → 智能分镜提取 → 分镜编辑 → 视频生成 → 预览        | 三栏式布局、可收起右侧属性面板、批量操作      |
| 分镜精细控制       | 景别/角度/运镜/情绪/时长/氛围/对白/配乐/音效/隐藏分镜                   | 首/尾/关键帧独立提示词、多版本管理            |
| 高级生成控制       | 参考图跨分镜引用、ControlNet骨骼/深度、智能对口型、模型/时长选择        | 动作可控 + 口型同步                           |
| 资产管理系统       | 角色/场景/道具/服装集中管理、智能提取 + 手动关联 + 提示词模板           | 项目资产库 vs 全局资产库双层体系              |
| 提示词模板库       | 分镜/角色/场景/视频/配乐/音效/综合提示词模板                            | 一键初始化新章节                              |
| 视频后期剪辑       | 时间线编辑、多轨视频/音频、素材库拖拽、最终导出                         | 从 AI 片段直接剪辑成完整短剧                  |
| Agent 工作流       | 剧情提取 / 角色提取 / 分镜建议 等可定制 Agent，支持可视化编排与测试     | 类似 Dify 的节点式工作流编辑器                |
| 模型管理           | 多供应商（OpenAI/Claude/通义/混元等）管理、模型分类（文本/图/视频）     | 每类可设默认模型、快速测试连接                |
| 生成素材管理       | 图片/视频统一预览、标签标记、过滤、批量导出                             | 支持优质素材快速复用                          |

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

说明：

- `openapi:update` 会先拉取 `http://127.0.0.1:8000/openapi.json` 到 `front/openapi.json`，再生成代码到 `front/src/services/generated/`
- 如需修改请求基础地址（默认同源 `/api`），可在应用启动处调用 `initOpenAPI('http://127.0.0.1:8000')`，配置文件见 `front/src/services/openapi.ts`


## 🚧 当前状态
项目原型规划中
- [x] 项目创建与全局配置
- [x] 章节拍摄核心工作台
- [x] 资产与提示词模板管理
- [x] 分镜精细编辑与视频生成控制
- [ ] 完整后期剪辑时间线（开发中）
- [ ] Agent 可视化编排（部分完成）
- [ ] 多模型供应商管理（开发中）
- [ ] 移动端适配（规划中）

## 📄 开源协议

Apache-2.0 license

欢迎 PR、Issue、Star ～  
也欢迎志同道合的朋友一起把 AI 短剧生产工具做成行业标杆！

## 💬 交流 & 反馈

- GitHub Issues
- 微信群 / Discord（待建）