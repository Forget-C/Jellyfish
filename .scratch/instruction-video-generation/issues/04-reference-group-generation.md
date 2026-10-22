# 04: 参考组按组编辑并进入视频生成

**What to build:** 用户按参考组准备本次素材，在一张卡中查看同组多图及对象、用途和来源，局部编辑目标组，并将同组图片作为同一主体完整传入视频模型。

**Blocked by:** None

**Status:** ready-for-agent

**Spec:** [AI 指令起草与参考媒体视频生成链路](../spec.md)，实施决策 5、6、8、10；验收 A05、A06 的参考组部分，A08、A09、A15 的主体参考路径，以及有关的 A16、A17、A20。

## Acceptance criteria

- [x] 普通参考按组展示卡片，同组多图保留在同一卡中，展示对应人物／物件或用途、缩略图、数量、来源及可用状态。
- [x] 未选参考时提供添加入口；候选或默认资产不自动产生实际绑定，明确应用后才显示该组到单元的输入关系。
- [x] 后端图投影提供稳定的参考组身份及编辑目标，当前编辑预览和保存后的关系一致。
- [x] 从组卡进入编辑只管理该组图片、参与对象及用途，应用不覆盖其他组、其他单元或首尾帧。
- [x] 应用一次更新并可撤销；取消、关闭或相关内容并发变化不会丢失原组或留下半组替换。
- [x] 继续遵守既有身份主体的一对象一组、单一来源和同组多图规则；其他用途沿用自身约束，不把身份主体规则扩大到所有参考。
- [x] 用途、对应对象、来源和输入归属分别表达并可查看，不新增平行的对象关联配置或图片识别推断。
- [x] 从场次保存到固定任务及供应商请求，主体身份、组内图片、顺序及类型一致；同组多图仍作为同一主体输入，不按图片数拆成多个主体。
- [x] 运行期间修改参考组不影响已提交任务；文件不可访问、归属不符、组不合法或模型不支持时明确阻止执行，不静默裁剪或改变生成模式。
- [x] 完成相应图契约、浏览器、场次 HTTP 和供应商请求验证，以及类型检查、后端检查、必要契约及文档同步。

## Validation

- 复用参考来源和身份主体分组先例，以真实浏览器操作多组、多图和更换来源，核对保存结果及非目标输入不变。
- 使用可区分媒体，经真实任务执行和媒体读取，在受控供应商请求中核对主体及图片归组；覆盖非法来源、对象和能力组合。
- 本票可沿用现有生成入口独立验证，不依赖 01、02 或 03 的界面完成。真实供应商验收由 08 汇总。


## Implementation and verification

2026-10-22：普通参考按组投影；组内多图、对象、用途和固定来源分别可见。添加入口无绑定时不产生输入边。编辑只管理所点参考组，取消、一次应用／撤销、来源替换与并发基线保护均保留其他输入。首尾帧共用 03 提供的显式作用域契约；指令画布继续聚合阅读参考。

- 红灯：场次 HTTP 图用例在旧聚合卡上无法找到独立主体组；真实浏览器在旧界面中没有“添加参考组”。新增缩略图边界断言又复现有限卡片高度裁切图片，调整为 360×480 后绿灯。
- `uv run --no-sync pytest tests/directing/test_reference_group_canvas.py tests/directing/test_reference_group_generation.py tests/directing/test_scene_video.py -q --tb=short`（`backend`）：14 passed。HTTP 保存、固定任务、真实任务执行及媒体读取一路进入受控供应商 HTTP 请求；两张不同 PNG 保留为同一主体且顺序不变。提交后修改参考不改变固定输入；运行时文件不可读取则失败且不发送供应商请求。
- `uv run --project backend --no-sync pytest backend/tests/directing/test_canvas_graph.py backend/tests/directing/test_unit_canvas_preview.py backend/tests/directing/test_identity_reference_groups.py -q --tb=short`：62 passed，覆盖投影、预览、非法主体／来源／能力组合及已有硬门槛。
- `PLAYWRIGHT_CHANNEL=chrome node front/tests/run-browser.mjs reference-source`：PASS（97.1s）。真实浏览器与隔离后端核对多组多图、对象和用途、单组应用／取消／撤销、来源替换、失败及迟到上传、并发变化、只读和窄屏。证据 `front/test-results/browser-fOFYGg`，包含组卡缩略图可见范围及 390px／1440px 截图。
- `PLAYWRIGHT_CHANNEL=chrome node front/tests/run-browser.mjs default-assets`：PASS（32.1s）。默认候选不自动绑定；来源失效仍保留已选固定文件，选框显示可读的失效来源。证据 `front/test-results/browser-kvIXi3`。
- `PLAYWRIGHT_CHANNEL=chrome node front/tests/run-browser.mjs canvas-graph`：PASS（24.4s），核对拆卡后的入口、来源、只读阅读和画布定位。证据 `front/test-results/browser-6YzsnR`。
- `pnpm --dir front run typecheck`、`git diff --check` 通过；`backend` 下 `uv run --no-sync pylint app` 为 10.00/10。
- 对外图字段及 generated client 复用 03 的已同步契约。同步当前架构与画布操作文档；新控件复用 WorkbenchButton，浏览器脚本沿用统一 runtime 的证据和清理。

上述供应商响应为 HTTP 边界受控响应，不代表真实模型生成质量；真实供应商验收仍由 08 汇总。综合 workbench 套件由集成阶段统一执行，避免与并行分支争用端口。
