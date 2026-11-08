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

场次工作台的按钮、图标、文本、弹窗与滚动规范见[工作台前端设计标准](https://github.com/Forget-C/Jellyfish/blob/main/docs/development/standards/workbench-design.md)，包含共享组件、开发示例和验证入口。

## 检查入口

从项目根目录运行：

```bash
pnpm --dir front run lint:check
pnpm --dir front run test:unit
pnpm --dir front run typecheck
pnpm --dir front run test:browser
```

`lint` 保留原始 ESLint 输出；`lint:check` 对照存量基线，新增问题或失效豁免均失败。修复旧问题后运行 `lint:baseline` 收缩基线；它不能接纳新问题。基线按文件、规则、消息及源代码行摘要识别，不依赖行号。

浏览器入口先执行环境预检，再按清单串行运行；共享端口的用例不会并发启动。套件、单用例、日志和证据说明以 `front/tests/README.md` 与 `front/tests/browser-suites.json` 为准。CI 使用同一入口，上传 `front/test-results/` 内的截图、JSON 与日志。
