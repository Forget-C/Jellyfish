# 06: 用 Ant Design X 承载双画布对话

Status: ready-for-agent
Completion: complete
Blocked by: 03

**What to build:** 从两种画布右侧的图标打开 X 对话面板，保留独立的画布交互、业务审批卡和原有结果。

对应[后续实现规格中的用户故事](../spec.md#user-stories) 20、22、27。

## Acceptance criteria

- [x] 桌面约 420px 的非模态面板、窄屏近全宽；固定标题及输入区，消息独立滚动。用户上翻阅读时位置保持，可返回最新进展。
- [x] 验收消息、附件、可折叠进度与模型操作，沿用站点主题和图标。业务审批及回执继续消费真实服务数据，组件加载状态不代表写入完成。
- [x] 真实页面验证中文输入法选词、回车发送、Shift+Enter 换行、键盘焦点和弹层；面板打开时仍可操作画布，停止入口符合当前服务能力。

## 验收记录

提交 `75929c74` 接入 Ant Design X 2.10 的 Bubble.List、Sender 与 ThoughtChain。双画布浏览器用例核对三种配色、375px 窄屏、历史跳转、附件、展开进度、键盘焦点、Shift+Enter 换行及输入法回车零审批请求。类型检查、lint 基线和生产构建通过。

## Comments

### 本轮遗漏复核

自由画布和分镜画布移除了提问范围下拉。真实页面回归验证 Ant Design X 附件列表与回复完成前可展开的进度，素材准备与实际观察分别展示。
