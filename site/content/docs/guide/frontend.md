---
title: "前端说明"
weight: 2
description: "理解前端页面组织、请求层和状态管理。"
---

前端位于 `front/`，使用 React 18、TypeScript、Vite 与 Ant Design。核心结构如下：

- `src/App.tsx`：路由入口
- `src/layouts/`：全局布局
- `src/pages/aiStudio/`：项目、章节、分镜、资产等页面
- `src/services/`：OpenAPI 生成客户端与请求封装
- `src/store/`：全局状态

## 页面组织思路

前端页面不是按“技术组件”分，而是按业务域分：

- `project/`
- `chapter/`
- `shots/`
- `assets/`
- `prompts/`
- `files/`
- `models/`
- `agents/`

## 请求层

前端主要通过 `front/src/services/generated/` 中的 OpenAPI 生成代码与后端通信。  
这意味着后端接口变更后，前端应同步执行一次 `pnpm run openapi:update`。

场次工作台的按钮、图标、文本、弹窗与滚动规范见[工作台前端设计标准](../workbench-design/)，包含共享组件、开发示例和验证入口。
