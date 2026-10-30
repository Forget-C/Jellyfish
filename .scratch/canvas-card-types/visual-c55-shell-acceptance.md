# 55：四类共同C外壳与工具栏避让验收

日期：2026-10-30。基于集成起点 `e5eca895` 的55独立实现；待合入后再由60收口。01–54与旧验收未改写。

## 改动与接缝

共同外壳作用于基础文本、基础图片、文本模型、图片模型：统一局部C表面／边框／圆角、43px轻量头部、模态图标、既有名称及必要同行状态，已保存不再常驻。模型专属旧标题覆盖移除，不新建名称字段。编辑正文外壳不叠加两层padding。四类窄屏重复“添加卡片／连接到”行移除，关闭后仍使用分类栏和卡片菜单的既有入口；其余复杂卡片原入口保留。这是本次C规格要求的局部适配，不修改场次工作台主题或共享详情行为。

默认定位测量顶部、面包屑／筛选、分类竖栏和底部工具，常驻竖栏右边额外留10px。首次主动打开才进行必要平移，输入／保存不触发平移；ResizeObserver在最终内容尺寸变化时仅限位编辑区。展开／窄屏仍为原会话，背景inert及操作弹窗优先级保留。

测试接缝为已确认的真实页面＋公开HTTP，使用现有隔离后端及受控外部服务。浏览器用例 `generation-canvas-common-shell` 已注册到统一入口和canvas-layout套件，没有新增内部测试API。

## 红绿及命令

- 红：Chrome运行新公共浏览器用例，旧代码因标题常驻“修改已同步”明确失败（期望0，实际1）。默认bundled Chromium未安装；切换已安装Chrome，没有安装或放宽测试。
- 绿：`PLAYWRIGHT_CHANNEL=chrome JELLYFISH_BROWSER_OUTPUT=/private/tmp/c55-verified node front/tests/generationCanvasCommonShell.browser.mjs` 通过，含四类三视口默认／展开、四类左右底边、可点击头部动作、同会话展开收起、保存不平移及HTTP保存／重开。
- 窄屏局部重复：`/private/tmp/c55-mobile-entry` 验证关闭后基础卡分类及卡片“连接到…”通过键盘可达，取消连接不改变业务。
- Node24.22.1下 `pnpm --dir front run typecheck` 通过；`git diff --check`通过。后端和公开契约未变，不机械运行Pylint／生成客户端。共享工作台完整套件及最终组合回归由集成阶段按相同产品树执行／记录。

## 实际阅图与逐区域结论

目标为已确认C最终原型四类ready图，本票只比较共同外壳，不能用正式空态和ready目标证明内容布局一致。已实际打开目标原图和以下24张原尺寸编辑区，逐一查看；同时查看12张左右底边正式整页上下文。最终证据根目录为 `/private/tmp/c55-verified`（相同产品状态的先行查看目录 `/private/tmp/c55-final`）。

| 卡片 | 三视口默认／展开原尺寸图（每项各两张） | 共同区域结论 | 留给对应票的已知差异 |
| --- | --- | --- | --- |
| 基础文本 | `text-1440-{default,expanded}-editor.png`、`text-3830-{default,expanded}-editor.png`、`text-390-{default,expanded}-editor.png` | 表面／边框／圆角、图标／名称同行、无头线、展开关闭及窄屏单头：通过。正常保存不常驻。 | 旧导入实心按钮和格式提示仍需56修改；正文／卡面密度不在本票宣称全部通过。 |
| 基础图片 | `image-1440-{default,expanded}-editor.png`、`image-3830-{default,expanded}-editor.png`、`image-390-{default,expanded}-editor.png` | 同上；窄屏没有附加画布操作行：通过。 | 本测试图片为空，旧右侧空信息列和单加号尚待57；不代验ready图片比例／元信息。 |
| 文本模型 | `model-text-1440-{default,expanded}-editor.png`、`model-text-3830-{default,expanded}-editor.png`、`model-text-390-{default,expanded}-editor.png` | 与基础卡同一外壳及标题层级，默认／展开一致：通过。 | 此fixture未选模型，诊断保留属正确状态；常驻引用／输出折叠行及双素材入口由58修正，不把它当ready模型视觉通过。 |
| 图片模型 | `model-image-1440-{default,expanded}-editor.png`、`model-image-3830-{default,expanded}-editor.png`、`model-image-390-{default,expanded}-editor.png` | 与其他三类同一共同表面／标题，必要按钮可达：通过。 | 无输出fixture不代验正式图片；参数同宽／裸数量与旧折叠行由58／59修正。 |

每个前缀另有不带`-editor`的正式整页上下文。视口分别为1440×960、3830×1688、390×844；“default”在390上按既有规则是窄屏近全屏编辑，不伪装桌面浮层。不同内容／未选模型状态明确记载，不以CSS数值断言代替图片审查。

靠边图为 `{text,image,model-text,model-image}-{left,right,bottom}-{avoidance,expanded}.png`：通过公开方向键移动卡片后真实打开，默认头部展开／关闭可点击，默认外框避开竖栏与左右视口、底边避开底部工具；展开背景工具暂停。实际查看12张默认整页，必要头部／正文无常驻工具遮盖；对应展开图已采集且动作实测，展开共同标题另由上表24图验证。本轮不以这些空素材状态替代后续有图、有多来源或长文的F矩阵。

## 限制与后续

55只完成共同外壳和避让，56–59仍需各自内容、状态和三视口F图；60完成至少36组独立矩阵及B摄影／编组回归。当前没有宣称四类全部视觉通过。浏览器既有Browserslist／Tailwind和Node弃用提示未更改；受控供应商／存储不证明真实模型艺术质量。
