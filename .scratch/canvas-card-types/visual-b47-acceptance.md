# 47：导入与连接控件视觉验收

2026-10-29，分支 `codex-b47`。基于集成分支 `52f76f9d` 实施，完成前同步 `82f61422`（43／45／46已集成）。01–42、spec与旧验收校验值保持不变。

## 交付

- 文本／创作依据导入改为WorkbenchButton＋上传图标；input隐藏但保留原生文件选择。文件名、读取状态、格式提示弱化展示，失败保留原正文；创作依据原文件名／选区仍通过既有字段保存，不新增持续输入。
- 可见按钮名称“导入文本文件”，隐藏input名称“文本文件选择”，避免同名按钮与文件输入造成辅助技术及自动化歧义；旧导入旅程仅同步定位名称，不删除断言。
- 圆形连接点可见直径30px，居中加号16px，命中区36px。主题颜色、默认隐藏、悬浮／焦点／选中与连接过程显示、兼容提示全部保留；键盘可见焦点描边新增明确表达。逻辑端点、候选、采用、剪刀和组织保护未改。
- 媒体input原本已隐藏并使用暗色加号菜单，本票保持其上传／替换／文件库／删除生命周期；用真实页面证明已有能力，而非重写。修正媒体用例端口登记为实际4275／8275，使统一入口预检有效。
- 新增`generation-canvas-input-controls`统一浏览器登记，4497／8497，归canvas-layout与generation。旧ports／edge／prewire显式打开模型按需管理区域；composer引用分类弹层按公开aria-controls定位，消除退场动画导致的双弹层strict竞态。所有原行为断言保留。

## 图片

已实际查看用户左右连接点原图（`codex-clipboard-6ada20d9-b915-47e5-ad16-0d0c0ad29307.png`）与B基线。正式卡片保持有限尺寸；相较参考超大卡片，连接圈按规格100%视图30px呈现，未复制超大空白。

最终截图：`/private/tmp/canvas-b47/final-controls/generation-canvas-input-controls/`。

| 状态 | 证据与观察 |
| --- | --- |
| 默认隐藏 | `default-hidden-plus.png`：左右加号默认隐去。 |
| 悬浮与键盘焦点 | `hover-plus-100.png`、`focus-plus-100.png`：左右各保留24px外边距，完整圆圈及居中加号可辨，键盘焦点蓝描边。 |
| 导入文件及反馈 | `themed-text-import.png`：暗色工作台按钮与成功文件名；原生白input不可见。 |
| 拖线与候选 | `drag-line.png`：拖动中持续显示连线，松开建立纯候选，HTTP确认没有绑定。 |
| 三视口全页 | `import-full-1440/390/3830.png`、`plus-full-1440/390/3830.png`：正式背景和编辑层级，窄屏无横向溢出，连接圈不裁切。 |

实际核对了全页与100%局部原图，包括按钮颜色／文字层级、圆圈尺寸／加号、默认／悬浮／键盘状态，而非只用命中区几何断言。父代理亦查看1440与390导入、全页圆圈；最初局部裁图的圆圈半裁问题已通过扩大截图边距修正。

## 验证

沿用真实页面＋公开HTTP，隔离后端数据库／TaskWorker，只对外部供应商／存储使用受控替身。

- RED：`/private/tmp/canvas-b47/red`，原生input仍可见，首条视觉断言失败。
- GREEN：统一入口 `PLAYWRIGHT_CHANNEL=chrome node front/tests/run-browser.mjs <case> --output <directory>`，每次preflight与用例均通过：

| case | 证据目录 | 验证行为 |
| --- | --- | --- |
| generation-canvas-input-controls | `/private/tmp/canvas-b47/final-controls` | 真实文件chooser取消／导入、文件名反馈、保存重开、默认隐藏／悬浮／键盘焦点、拖线持续反馈、纯候选、3视口。 |
| generation-canvas-media | `/private/tmp/canvas-b47/integrated-media` | 图片上传失败／替换失败保留、保存冲突、库复用、晚到上传不复活删除卡、音视频原生预览。 |
| generation-canvas-ports | `/private/tmp/canvas-b47/integrated-ports` | 端口提示、纯候选与明确采用分开、实际文本预检。 |
| generation-canvas-accessible-connections | `/private/tmp/canvas-b47/integrated-accessible` | 鼠标／键盘／触摸、用途、无输入拒绝、只读、窄屏会话／添加恢复。 |
| generation-canvas-edge-management | `/private/tmp/canvas-b47/integrated-edges` | 候选去重、多用途采用、剪刀引用保护、不同用途独立删除及实际视频请求。 |
| generation-canvas-prewire | `/private/tmp/canvas-b47/integrated-prewire` | 空输出预连接、直接输出发布、明确采用及受控请求。 |
| generation-canvas-composer | `/private/tmp/canvas-b47/integrated-composer2` | 引用输入／粘贴／分类／顺序、文本依据导入及文件名选区重开。 |
| generation-canvas-journey | `/private/tmp/canvas-b47/integrated-journey` | 全目录、导入、名称参考、表演设计／媒体、文本独立采用、名称映射、生成及输出另存与恢复。 |

`pnpm --dir front run typecheck`通过；修改的TSX ESLint无error，Graph有既有一条inspectTarget useEffect依赖warning（本票未改相关effect）；`git diff --check`通过。

无后端／公开契约变化，不机械再生OpenAPI；不宣称真实供应商质量。文本File.text读取失败保留原catch，未通过伪造浏览器内部File实现制造失败；真实取消／成功与媒体外部失败覆盖主要导入旅程。48继续补跨票图片对照及最终全局验收。
