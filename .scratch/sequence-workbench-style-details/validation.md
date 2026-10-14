# 工作台控件细节验收

日期：2026-10-14
状态：完成。

## 改动

- 版本与任务箭头统一为 12px 次级灰，8px 间距，展开旋转；修正 Ant 按钮默认样式覆盖 caption 布局的问题。
- 六岗／项目资产栏目、镜头列表及下拉选中项使用灰阶选中态，保留主操作强调色及语义状态色。
- 补齐局部 `colorBgLayout` 与 Segmented、Select 主题配置，任务过滤不再继承全站浅色底。
- 任务卡片增加工作台局部边框、间距、排列及标题颜色；避免浅色样式或缺失的通用工具类使标题不可读。
- 工作台任务计数 0 时隐藏，非零灰色徽标，超过 99 显示 99+；可访问标签保留完整排队及运行任务数量。
- 保留细蓝色键盘焦点。共享任务中心通过显式 workbench 配置区分外观，全站原有计数规则与浅色样式保持不变。

## 验证

| 检查 | 结果 |
| --- | --- |
| `pnpm --dir front run typecheck` | 最终应用代码通过 |
| `PLAYWRIGHT_CHANNEL=chrome node front/tests/sceneWorkbenchStyle.browser.mjs` | 通过：四画布 1440／1280／390、版本与浮层交互、媒体与导出；新增控件细节检查全部通过 |
| `PLAYWRIGHT_CHANNEL=chrome node front/tests/sceneTaskHistory.browser.mjs` | 通过：历史固定记录、未保存内容保留及跨版本回跳；旧脚本已适配现有保存菜单入口 |
| `git diff --check` | 通过 |

新增检查覆盖选中／悬停配色、箭头展开后的实际间距、键盘焦点、0／1／12／99／100 活动任务、已完成任务不计入、暗色过滤与卡片文字、桌面／窄屏抽屉边界以及共享浅色实例。任务展示状态使用隔离的合成任务，业务回归使用临时数据库与公开接口；没有生成付费任务或修改用户项目数据。

## 截图

- [角色工具选中态](evidence/details-role-selected.png)
- [版本下拉入口](evidence/details-version-open.png)
- [任务计数及键盘焦点](evidence/details-task-count-focus.png)
- [桌面任务中心](evidence/details-tasks-1440.png)
- [窄屏任务中心](evidence/details-tasks-390.png)
- [全站浅色任务中心](evidence/details-light-task-center.png)
- [四画布尺寸检查](evidence/measurements.json)

完整浏览器证据临时目录：`jellyfish-workbench-style-WH1lIk`、`jellyfish-scene-version-kYN3IT`。

## 边界

本次未修改后端、接口、业务过滤条件或任务统计。局部修复不扩展到全站通用工具类配置；既有 Browserslist、Tailwind content 和 Node 弃用提示仍存在。没有未完成的必要检查。本轮改动尚未提交 commit。


## 第二轮详细审查（2026-10-14）

范围：当前四画布及其关系导航、全场总览、六岗编辑、设计建议、任务中心、版本／保存／导出菜单；按实际路由检查，未把旧工作区或全站浅色 CSS 当成本轮问题。

### 新发现并修正

| 问题 | 原因与处理 | 验证 |
| --- | --- | --- |
| 关系树选中态仍有旧蓝色规则 | 统一到灰阶，保留当前对象标识 | 当前对象计算样式为灰阶 |
| 全场总览蓝底、蓝色关系线与粗描边 | 普通选择与键盘焦点混在一起；改为灰底、灰色边框与关联线，焦点单独细蓝描边 | [总览截图](evidence/audit-overview.png)及选中项计算样式 |
| 六岗数组的“移除”失去红色提示 | 通用 `.ant-btn` 规则覆盖危险按钮；通用规则排除危险、链接和禁用类型，保留原组件语义 | [移除按钮截图](evidence/audit-danger-actions.png)，文字／边框恢复 `rgb(220, 68, 70)` |
| 设计建议范围仍使用默认蓝色选择 | Radio.Button 未被上一轮选择规则覆盖；增加范围选择的局部灰阶规则 | [范围切换截图](evidence/audit-design-scope.png)，背景 `rgb(56, 56, 56)` |
| 画布原生按钮及输入框焦点粗细不一致 | 旧规则仍为 2px；统一受影响控件为 1px，保留键盘可见焦点 | CSS 规则检查，已有任务焦点回归继续通过 |

同步避免卡片通用按钮底色覆盖主操作；来源链接恢复组件自身的链接外观。危险色、错误／警告／成功色与真正提交操作的蓝色继续保留。

### 排除的疑点

禁用生成按钮首次即时读数来自颜色过渡中间态；过渡结束后为暗底灰字，未将其误报为产品缺陷。回归改为等待动画结束后采集样式。弹窗关闭后仍挂载的控件也不作为当前可见选择目标。

### 最终结果

- `pnpm --dir front run typecheck`：通过。
- `PLAYWRIGHT_CHANNEL=chrome node front/tests/sceneWorkbenchStyle.browser.mjs`：通过，最终证据目录 `jellyfish-workbench-style-4peB4B`。包含全部原有四画布检查及新增控件检查。
- `git diff --check`：通过。
- 上轮任务历史回归结果复用；本轮未改任务历史业务或组件。
- [修正前记录](evidence/additional-controls-before.json)与[修正后记录](evidence/additional-controls.json)。前记录中的禁用态瞬时读数不计作已确认问题；outline 数值也须结合 outline-style 才代表可见焦点。
- 最终总览、危险操作、范围切换、任务中心桌面／窄屏截图已人工检查。检查覆盖上述代表性状态，不声称穷尽所有业务数据组合。
- 本轮与上一轮细节改动均尚未提交。

## AI 生成按钮截图反馈

整场／局部设计生成按钮改为中性灰，悬停保持灰阶，上下各留 12px。类型检查、扩展样式浏览器回归和 diff 检查通过；回归新增正常／悬停灰阶、实际间距及禁用态检查，未点击提交或产生付费任务。最终证据：`jellyfish-workbench-style-pTJnwF`。

[生成按钮最终效果](evidence/design-generate-neutral.png)

## 顶部 AI 三角入口

- 已落实圆润三角本体、两行说明、56px 高点击区域及灰阶悬停；保留打开弹窗与原任务状态文字。
- `pnpm --dir front run typecheck`：通过。
- `PLAYWRIGHT_CHANNEL=chrome /opt/homebrew/bin/node front/tests/sceneWorkbenchStyle.browser.mjs`：通过，证据目录 `jellyfish-workbench-style-8Zglrb`；包含四画布、桌面／窄屏布局、浮层、未保存输入与目标弹窗检查。默认 Node 18 不满足当前 Playwright 要求，改用已有 Homebrew Node 执行。
- 已检查 1440px 与 390px 截图，入口文字与相邻操作无挤压。
- [桌面效果](evidence/triangle-entry-1440.png)、[1280px 效果](evidence/triangle-entry-1280.png)、[窄屏效果](evidence/triangle-entry-390.png)。
- 未提交 commit。

## 魔棒入口（替代三角入口）

入口改为 20px 魔棒星芒图标、38px 高灰阶按钮及单行文字，整场说明移入悬停提示。保留查看任务／建议的状态文案与打开弹窗行为。

- TypeScript 检查及 `git diff --check` 通过。
- 四画布浏览器回归通过：`PLAYWRIGHT_CHANNEL=chrome /opt/homebrew/bin/node front/tests/sceneWorkbenchStyle.browser.mjs`，证据目录 `jellyfish-workbench-style-36WtHI`。首次间距检查捕获弹窗缩放动画中间态，增加等待弹窗动画结束后复验通过。
- 已检查桌面与窄屏实际截图：[桌面](evidence/wand-entry-1440.png)、[窄屏](evidence/wand-entry-390.png)。
- 尚未提交。
