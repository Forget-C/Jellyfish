---
title: "前端基础布局"
weight: 8
description: "当前前端应用壳、页面滚动边界与满高工作台的布局约定。"
---

## 应用壳

`MainLayout` 是所有路由页面的唯一应用壳。它占满浏览器视口，侧边栏和顶栏固定在壳内；浏览器 `body` 不承担页面滚动，避免路由切换后出现双滚动条或内容越过应用边界。

`#root`、应用壳和主内容区均建立了明确的高度链，并在可收缩的 flex 容器上设置 `min-height: 0` 与 `min-width: 0`。这使子页面能正确计算 `height: 100%`，也避免长内容或宽表格撑破父级。

## 路由内容与滚动

路由出口由 `.app-route-viewport` 承载。它是普通页面的默认滚动边界：没有自行声明滚动容器的页面仍可纵向滚动，且超宽内容不会绘制到应用壳之外。

页面无需为常规列表、表单或详情页重复设置页面级 `overflow`。页面内需要横向查看的表格、代码块或素材带，应在其自身容器上显式使用 `overflow-x: auto`。

前端通过 `src/components/layout/PageLayout.tsx` 提供两项工作台原语：

- `WorkspaceLayout`：建立满高、可收缩的工作台根节点。
- `WorkspaceScrollPanel`：作为自然高度内容的默认垂直滚动面板；它会隐藏意外的横向溢出。

项目工作台等带固定工具栏的页面必须使用这组原语；tab 不得依赖父级的 `overflow: hidden` 来裁切自然高度内容。工作台的默认滚动面板不得使用 `overflow: auto`；需要横向浏览的表格、卡片带或代码块必须在自己的局部容器上显式使用 `overflow-x: auto`。

## 满高工作台

分镜工作室、镜头编辑、模型管理等多栏工作台可以在根节点使用 `height: 100%`（Tailwind 的 `h-full`），并把滚动职责分配给实际需要滚动的面板。

- 工作台根节点：`height: 100%`、`min-height: 0`，通常为纵向 flex 容器。
- 可收缩的中间容器：必须保留 `min-height: 0`；横向分栏同时保留 `min-width: 0`。
- 单个可滚动面板：使用 `overflow: auto`；只应在需要裁切视觉素材或固定画布时使用 `overflow: hidden`。

全高的 Ant Design `Card` 应使用 `app-fill-card`，使 Card body 获得可分配的剩余高度；消息列表、表格等内容区再使用 `flex: 1`、`min-height: 0` 和 `overflow: auto` 成为唯一的局部滚动面板。

这样普通页面保持单一、可预期的滚动入口，而工作台仍能拥有独立的列表、画布和检查器滚动区。
