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

## AI 设计弹窗重组

入口和标题统一为 AI 设计，按准备／生成中／结果展示。首次与已有人工内容采用不同操作文案，局部仍限定已有字段。生成和应用置于固定底部，关闭不丢输入。原文、历史与固定依据可展开；结果显示六岗摘要和完整差异。

验证通过：
- `pnpm --dir front run typecheck`。
- `PLAYWRIGHT_CHANNEL=chrome /opt/homebrew/bin/node front/tests/sceneWorkbenchStyle.browser.mjs`：首次空设计、局部未选禁用、关闭保留输入、1440／390px 主动作可见及原有四画布回归。证据 `jellyfish-workbench-style-Doouij`。
- 同运行环境 `sceneVersionWorkbench.browser.mjs`：生成、提交未核实恢复、当前编辑差异、手动应用、局部字段范围及原有版本回归。证据 `jellyfish-scene-version-W7vWXu`。
- `sceneDesignReferences.browser.mjs`：引用冲突阻止应用，修复后应用和撤销。证据 `jellyfish-scene-version-xAJyJ9`。
- `sceneCopyDesignTasks.browser.mjs`：原请求持久化和核实、运行中复制保护、未应用结果不会自动写入副本。证据 `jellyfish-scene-version-gBXiLF`。
- `git diff --check`。后两项回归中的旧工具栏直达定位已同步为当前菜单路径。

人工检查[桌面准备页](evidence/ai-prepare-1440.png)、[窄屏准备页](evidence/ai-prepare-390.png)、[局部设计](evidence/ai-partial-design.png)与[结果差异页](evidence/ai-result-preview.png)。未调用真实生成供应商，浏览器测试使用本地测试服务。尚未提交。

## 原文展开、轮询与滚动修复

- 原文只有一个文本节点，按实际行数检测展开入口，短文不显示按钮；长文展开／收起通过浏览器验证。
- 首次读取才显示加载图标，后台刷新与错误使用固定高度状态区域。延迟 GET、失败及手动重试前后，对比标题坐标、正文 scrollTop 与依据展开状态一致。
- AI 弹窗使用暗灰细滚动条和 stable gutter，取消差异正文的独立纵向高度上限；长原文滚动时底部生成按钮仍可见。
- 类型检查、diff 检查通过。样式回归通过（`jellyfish-workbench-style-tx6mBE`），请求恢复与轮询回归通过（`jellyfish-scene-version-p5kMLp`）。均使用 `PLAYWRIGHT_CHANNEL=chrome /opt/homebrew/bin/node` 运行对应脚本。
- 已检查[长原文截图](evidence/ai-long-source.png)。系统自动隐藏滚动条时截图不一定显示滑块，标准滚动条配色与 gutter 已通过计算样式断言。
- 上轮结果应用及引用冲突验证复用，本轮未改这些逻辑。尚未提交。

## 来源成功判定与结果区优化

根因：生成阶段仅验证结构，新增 Note 缺少本次模型来源却能返回成功；应用预览才校验来源。将原应用规则提取为共享校验，在生成结束前执行，与结构错误共用一次纠错；不移除应用校验，不伪造来源。

- 回归先红：`backend/.venv/bin/python -m pytest tests/directing/test_scene_design_suggestions.py -k generation_retries -q`（在 backend 中使用 `.venv/bin/python`），正确测试数据下四类来源均在应重试处失败：实际仅调用一次模型。
- 修复后整场／局部覆盖 chapter-only、伪造人工来源、旧任务、错误版本和保留人工 Note；集成测试串联错误来源→纠错→TaskService.finish→HTTP preview。相关四个文件共 40 测试通过：test_scene_design_suggestions、test_workspace、test_participant_scope、test_style。
- 前端类型检查及 diff 检查通过；工作台样式（kKAmtM）、请求恢复与静默轮询（Nw5YAL）、引用修复及历史来源错误重新生成入口（uHrBcl）浏览器回归通过。首次图标检查发现装饰图标影响按钮可访问名称，已用 aria-hidden 修正；引用修复断言改为等待异步内容更新。
- [结果分区与新设计按钮](evidence/ai-basis-and-actions.png)已人工检查。
- `UV_CACHE_DIR=/tmp/jellyfish-uv-cache uv run pylint app` 已执行，未通过：未改动文件中的 task_worker.py 两项、studio_assets.py 一项、lab_generation_tasks.py 一项、task_queries.py 一项，共 5 项既有问题；本次修改文件没有 Pylint 报告。未顺手修改无关代码。
- 未调用真实付费模型；测试模拟模型回复并使用真实生成校验与 HTTP 预览。未读取或改写用户已有任务数据，历史不合格结果仍需重新生成。尚未提交。
