# 场次工作台样式优化验证

日期：2026-10-14
状态：实施与验收完成。

## 范围

导演、单元、指令、编辑四画布及共用工具栏、内部面板与弹窗。沿用公开接口和隔离临时数据库，未修改用户项目数据。采用中性黑灰、弱边框点阵、浮动图标工具与外置节点标题，保留关键业务状态的可读性。

## 验证结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| `node --test front/tests/*.test.mjs` | 158 passed，0 failed | [日志](evidence/unit-tests.log) |
| `pnpm --dir front run typecheck` | 通过，退出码 0 | 最终交付恢复按钮修改后复验 |
| `PLAYWRIGHT_CHANNEL=chrome node front/tests/sceneCanvasNavigation.browser.mjs` | 通过 | 临时证据目录 `jellyfish-scene-version-TXGkQ3`：60 镜头、跨画布选择、未保存正文、2766 字长指令、窄屏与键盘 |
| `PLAYWRIGHT_CHANNEL=chrome node front/tests/sceneVersionWorkbench.browser.mjs` | 通过 | 临时证据目录 `jellyfish-scene-version-QsS3rX`：保存失败与恢复、版本切换、交接、六岗设计及资产工具 |
| `PLAYWRIGHT_CHANNEL=chrome node front/tests/sceneWorkbenchStyle.browser.mjs` | 通过 | `jellyfish-workbench-style-Z8V6eB`；截图和尺寸数据已保存在 [evidence](evidence/measurements.json) |
| `git diff --check` | 通过 | 无空白错误 |

## 按规格验收

| 规格 | 实现与验证 |
| --- | --- |
| Q1、Q2：四画布统一视觉与布局 | 1440、1280、390 三种宽度逐一检查背景、卡片、工具栏边界及按钮互不重叠；人工查看桌面、窄屏截图以及媒体、时间线 |
| Q3：顶部操作分组 | 场次与版本、保存、四画布切换、当前操作、任务、关系入口与更多；真实点击新建／另存、自动保存、导出尺寸／记录、批量拍摄；另存结果与源内容一致 |
| Q4：右侧互斥并保留输入 | 关系树默认关闭；关系导航与快捷编辑互斥；输入在切换、关闭和重新打开后仍保留 |
| Q5：摘要及关键状态 | 原文和叙事观点展开不保存；长指令收纳、展开编辑；单元准备度、指令检查和媒体预览仍可见；占位片段导出错误可见 |
| Q6：悬浮且视角完全不动 | 逐一断言浮层打开、切换、关闭前后的画布 transform 相同；不改节点位置、不自动适配或平移 |
| Q7：复杂详情宽弹窗 | 六岗设计保持宽弹窗并验证实际宽度；原文差异、导出记录沿用独立弹窗；样式统一 |
| Q8：实施与验证 | 类型检查、单元测试、三组浏览器回归完成；对应架构说明已同步 |

## 截图

| 画布 | 桌面 1440 | 窄屏 390 |
| --- | --- | --- |
| 导演 | [截图](evidence/director-1440.png) | [截图](evidence/director-390.png) |
| 单元 | [截图](evidence/units-1440.png) | [截图](evidence/units-390.png) |
| 指令 | [截图](evidence/instructions-1440.png) | [截图](evidence/instructions-390.png) |
| 编辑 | [截图](evidence/edit-1440.png) | [截图](evidence/edit-390.png) |

另包含 1280 宽度、空场次、六岗弹窗、[真实媒体预览](evidence/edit-real-media.png)、[时间线编辑](evidence/edit-timeline.png)及[导出拦截](evidence/export-validation.png)截图。窄屏通过用户主动节点定位查看卡片，未引入自动重排。

## 本轮复现并修正

- 关系树入口被快捷编辑浮层遮挡：入口移至顶部固定工具区。
- 快捷编辑浮层覆盖撤销／重做：右侧面板为底部固定工具留出空间。
- 交付错误收纳后恢复入口不够明确：菜单外显示提示，复用原有提交标签与禁用条件；存储失败可直接重读凭据，浏览器回归验证恢复成功。
- 自动化适配菜单与镜头选择区，继续通过用户入口操作，不用强制点击绕过遮挡。

## 环境与边界

- 测试后端／Vite 使用 `8193`／`4193`，浏览器脚本顺序执行；服务均已清理。
- 使用已安装的 Chrome 独立临时配置运行；浏览器验收需允许隔离本地服务绑定端口。
- 媒体来自隔离测试夹具，未调用付费模型供应商；本次不验证外部生成服务可用性。
- 本次未修改后端应用、接口 schema 或前端依赖，不要求生成 OpenAPI 或运行后端 Pylint。
- 开发服务器仍提示 Browserslist 数据过期、Tailwind content 未配置及 Node 旧 API 警告，不影响上述检查结果。
- 用户工作区原有的其他修改未纳入本次实现；本次无未完成的必要检查。
