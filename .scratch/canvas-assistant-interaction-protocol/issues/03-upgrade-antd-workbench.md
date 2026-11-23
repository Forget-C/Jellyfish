# 03: 升级 Ant Design 并验收现有工作台

Status: ready-for-agent
Completion: complete
Blocked by: None

**What to build:** 在保留 React 18.2 的前提下完成 UI 基础库迁移，用现有真实工作台单独验收依赖升级。

对应[后续实现规格中的用户故事](../spec.md#user-stories) 27。

## Acceptance criteria

- [x] 先升至最新 5.x，处理受影响入口的弃用项并验证；再升到兼容 Ant Design X 2.x 的 Ant Design 6.x 和图标库 6.x。类型检查与前端构建通过。
- [x] 桌面与窄屏上打开双画布及代表性使用方，验证跟随主站与三种工作台配色、下拉、Popover、Modal 和弹层挂载、遮挡及键盘返回焦点。
- [x] 核对依赖内部类型和组件内部选择器所影响的控件。可在接入 X 前独立演示消息输入、选择模型、打开和关闭浮层。

## 验收记录

`3cc78f49` 完成 5.29 中间升级，`40b76066` 将 Ant Design 升至 6.7.2、图标库升至 6.3.4，并保留 React 18。类型检查、构建、前端单测、lint 基线与真实双画布、工作台、外观偏好浏览器用例通过。窄屏菜单 Escape 焦点归还已复测。
