---
title: "场次试拍交互重设计：固定调整工作区"
description: "针对入口分散和状态重复，以固定编辑区、就地修改预览和集中检查结论重组试拍页面。"
weight: 36
status: completed
---

## 设计评估

上一轮指令生命周期能力已实现，但多处独立入口仍要求用户在正文、问题、修改面板和历史之间切换。仅收起技术信息不能解决操作路径分散；本轮将修改过程放在稳定、可见的主区。

设计阶段使用 Sites 制作独立可点击预览，经用户确认后将布局与交互接入 Jellyfish 实际试拍页。独立预览使用虚构场次，不连接真实项目和模型；其中的文案规则与计时检查仅演示交互。实际应用沿用既有后端生成、采用和复检能力。

[打开私有交互预览](https://jellyfish-instruction-studio.jellyfishai571655.chatgpt.site)

## 页面组织

1. 左侧：场次阶段与拍摄单元，选中对象始终明确。
2. 顶部：单元标题、三步流程、一行拍摄设置；历史作为辅助入口。
3. 中部：当前画面与动作摘要、受限字段直接编辑、统一修改要求。无需先打开正文或抽屉。
4. 右侧：固定指令的检查结论与需要处理的问题。建议直接加入同一个修改要求，不再为每个问题创建独立输入区。
5. 修改预览：紧接修改要求下方，展示实际改变的内容和唯一采用入口。继续编辑后标记待更新，不能采用旧预览。
6. 完整指令、设计依据、历史和技术详情按需查看，不成为普通路径的前置步骤。

移动端先显示检查摘要，“查看并处理”展开必要问题；接着为内容与修改区。保留同一条操作路径，避免横向抽屉与正文同时争夺空间。

## 关键流程

加入建议或填写要求 → 预览修改 → 核对变化 → 采用并重新检查 → 明确确认检查结论 → 进入试拍。

- 未检查、存在问题和检查通过后均可主动修改。
- 直接字段编辑同样先预览，不能绕过采用及复检。
- 修改设置导致旧检查失效，必须重新检查。
- 候选仅表示生成产物，不自动成为剪辑采用。
- 预览历史不切换当前指令；已有视频保持其提交时身份。
- 无变化不给采用入口；存在未解决问题不能开始试拍。

真实应用复用现有 generated client、候选身份、草稿保护、正式检查与分步恢复契约，不用预览中的本地模拟替换业务校验。六岗检查和模型能力预检仍由既有服务完成。

## 参考及取舍

- [Runway 生成与迭代流程](https://help.runwayml.com/hc/en-us/articles/37327109429011-Creating-with-Gen-4-Video)：参考输入与设置靠近、会话内连续迭代的方式，不照搬其模型参数。
- [Firefly 视频生成面板](https://helpx.adobe.com/firefly/web/firefly-video-editor/generate-videos/generate-videos-using-runway-video-models.html)：参考生成操作与历史分区，以及低频参数按需展开。

没有引入聊天系统、无限画布或新增版本树。保留 Jellyfish 的三阶段职责和“采用后复检、明确试拍”边界。

## 预览验证与后续范围

1440／1024／768／375px 浏览器检查通过，无横向溢出；已验证建议输入、修改预览、要求变化后更新、采用复检、历史只读与显式试拍。演示代码和设计说明位于 `design-previews/instruction-studio` 独立 Sites 项目；不包含真实媒体生成。

应用改造已围绕 `ProductionWorkbench`、`ReviewRevisionPanel`、`ShootReview` 与 `ShootInstructions` 重组展示职责，复用已有后端生命周期；完整指令、拍摄设置和历史使用辅助详情抽屉，试拍候选保留桌面侧栏和窄屏抽屉。

## 实施任务（用户已确认）

2026-09-28：用户确认按预览模式落地。沿用当前工作区未提交的生命周期实现；只改相关前端和文档，不重新发布独立 Sites 预览或修改后端契约。

- [x] R1 固定编辑区：`ReviewRevisionPanel.tsx` 不再通过详情 portal 展示；保留草稿、候选身份、人工字段、生成与采用恢复。默认展示当前内容、统一输入和内联预览。`ShootReview.tsx` 将建议加入统一输入，不新增逐问题编辑入口；旧逐项草稿按需可查看编辑。
- [x] R2 页面整合：`ProductionWorkbench.tsx` 提供编辑主区和检查侧栏；`SequenceWorkspacePage.tsx` 分别传入编辑与检查内容。检查进度、检查动作、结论确认位于侧栏，移除同一步顶部重复主按钮；完整指令和历史仍使用现有详情。建议及正文编辑入口准确聚焦内联区域。
- [x] R3 展示与响应式：`ShootInstructions.tsx` 精简摘要/历史入口，`workspace.css` 按预览的留白、分区和层级适配现有应用。移动端先显示检查摘要，必要问题可展开；原主要业务及任务入口保持可达。
- [x] R4 验证与文档：更新 `workspaceInstructionLifecycle.browser.mjs`、`workspaceReviewRevision.browser.mjs`、`workspaceShootProgress.browser.mjs`，确认无需打开修改抽屉即可完成要求→预览→更新→采用→检查；覆盖建议添加、直接编辑、迟到结果、恢复、来源隔离、历史及四尺寸。执行相关纯逻辑测试、`pnpm --dir front run typecheck`，同步架构和指南；保留截图与真实结果。

验证入口：从根目录运行 `node --test front/tests/reviewRevision.test.mjs front/tests/workspaceGuidance.test.mjs front/tests/workspacePreparation.test.mjs`，三组对应浏览器脚本及 `pnpm --dir front run typecheck`。浏览器运行使用本机已有 Playwright 环境和隔离数据，不发起真实拍摄。


## 应用验收记录（2026-09-28）

- 固定编辑区无需打开抽屉；建议追加到统一输入，切换步骤后不会重复追加。直接字段编辑保留草稿，清空旧逐项方向不会突然关闭输入。
- 有效预览将“更新修改方案”降为次操作；“采用并重新检查”保持唯一采用入口。旧预览、无变化及未完成选择均不能采用。检查结论保存不受问题折叠影响。
- 完整指令与历史按需打开；异步结果不抢占详情。候选页保留桌面侧栏以支持连续切换视频，窄屏仍为抽屉。
- 22 项相关纯逻辑测试通过；前端类型检查通过。浏览器使用隔离接口，无真实模型调用或媒体生成。
- `workspaceInstructionLifecycle.browser.mjs`、`workspaceReviewRevision.browser.mjs` 验证修改与采用生命周期；`workspaceShootSteps.browser.mjs`、`workspaceShootFlow.browser.mjs` 验证准备和候选浏览；`workspaceShootProgress.browser.mjs` 验证检查确认、详情定位和试拍回跳。五组浏览器回归均通过。四尺寸为 1440／1024／768／375px，检查无页面横向溢出及采用按钮可点击。
- 截图和请求记录保存于 `site/static/images/directing-workbench/interaction-redesign/`。截图为实际应用运行隔离数据，不是 Sites 预览截图。尚未进行真实用户可用性访谈。

[桌面默认页](/images/directing-workbench/interaction-redesign/default-1440.png) · [手机默认页](/images/directing-workbench/interaction-redesign/default-375.png) · [桌面修改预览](/images/directing-workbench/interaction-redesign/proposal-1440.png) · [手机修改预览](/images/directing-workbench/interaction-redesign/proposal-375.png)
