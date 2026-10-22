# 06: 指令画布只读输入核对与回跳

**What to build:** 用户在指令画布的一张“本次输入”卡核对首帧、尾帧及参考组，查看大图、来源和承接信息，修改时回到同一单元的准确输入卡片。

**Blocked by:** 03 — 首尾帧独立配置并进入视频生成；04 — 参考组按组编辑并进入视频生成

**Status:** ready-for-agent

**Spec:** [AI 指令起草与参考媒体视频生成链路](../spec.md)，实施决策 5、6、10；验收 A14、A20。

## Acceptance criteria

- [x] 指令画布保留一张只读“本次输入”聚合卡，内部按首帧、尾帧和参考组清楚分区，展示当前明确单元的实际输入。
- [x] 首尾帧显示缩略图、输入角色、来源、承接对象及可用状态；参考组显示对应人物／物件或用途、缩略图和数量。
- [x] 未选择、待绑定、不可用与加载或读取失败分别表达，不能用默认候选冒充已选素材，也不能把读取失败当作无输入。
- [x] 同图首尾帧保持两个位置；同组多图按组呈现；来源、对应对象和输入位置不混为一个分类。
- [x] 点击图片查看大图，来源及承接依据可查看；卡片连到当前指令卡，准确表达本次生成媒体输入。
- [x] “修改”进入同一个明确单元并定位首帧、尾帧或目标参考组；依赖 03、04 提供的输入身份及编辑目标，不凭卡片标题、数组位置或图片文件猜测对象。
- [x] 回跳保留当前未保存编辑，其他单元或旧的浏览选择不能覆盖本次明确目标；不在指令画布直接换图或拖线编辑。
- [x] 本次输入展示遵守已有当前编辑和保存快照机制；历史任务的固定输入继续从生成记录查看，不被当前参考替代。
- [x] 依赖状态可基于既有合法绑定或待绑定数据独立验证；本票的回跳目标不以 05 新承接操作完成为前置。
- [x] 键盘、只读、窄屏、大图关闭和焦点恢复符合工作台约定；完成对应图投影与浏览器测试、类型检查及必要契约和文档同步。

## Validation

- 通过场次接口构造无输入、首帧、首尾帧、主体多组和合法承接输入，验证后端投影与浏览器显示一致。
- 实际点击大图、来源及每个修改入口，断言目标单元和输入卡片准确，并确认没有提交生成或修改参考请求。
- 验证同一图片占用两个位置、参考组重排和当前未保存编辑的场景，避免错误定位或旧数据覆盖。


## Comments

### Implementation and verification

2026-10-22：指令图保留一个“本次输入”节点和媒体输入连线，使用既有 sources 记录精确跨画布目标；页面分区与修改入口复用当前编辑的服务端单元图、首尾位置、主体组身份及 edit_target。无需新增 schema 字段或手写客户端。当前参考与历史任务固定输入继续分别阅读。

- HTTP 红灯：旧聚合节点仍为“参考素材”且缺少逐输入来源目标。实现后 `backend` 下 `uv run --no-sync pytest tests/directing/test_instruction_inputs_canvas.py tests/directing/test_canvas_graph.py tests/directing/test_unit_canvas_preview.py -q --tb=short`：38 passed，覆盖单聚合卡、同图首尾、组内多图、完整预览、精确外部地址与输入连线，复用失效文件和预览回归。
- 浏览器红灯：旧界面没有“本次输入”分区。后续真实键盘验收还发现大图关闭时详情暂时 inert 导致焦点恢复失败；按模态关闭完成时序恢复后通过。
- `PLAYWRIGHT_CHANNEL=chrome node front/tests/run-browser.mjs instruction-inputs`：PASS 17.4s（合入 `e0b4f83` 后重跑），证据 `front/test-results/browser-erLyKE`。真实浏览器与隔离后端覆盖空输入、同图两位置、主体同组双图、来源、大图读取与键盘焦点、标题碰撞／地址改名／节点逆序后四个精确回跳、未保存指令与参考修改／撤销、只读、390px 详情／大图，以及零浏览器保存和生成请求。合法已采用片段通过真实提帧 HTTP 建立承接后显示原片段／版本／帧时间；传输边界受控响应分别验证加载中、图读取失败、文件不可用与原图读取失败。
- `PLAYWRIGHT_CHANNEL=chrome node front/tests/run-browser.mjs instruction-evidence`：PASS 14.0s，证据 `front/test-results/browser-k2OHVF`，原指令证据刷新、编辑和焦点保护保持有效。
- `pnpm --dir front run typecheck`、`git diff --check` 通过；`backend` 下 `uv run --no-sync pylint app`：10.00/10。
- 合入 `e0b4f83` 后重跑 `pnpm --dir front run typecheck`、`pnpm --dir front run lint:check`、38 项图接口测试与 `uv run pylint app` 均通过；lint 为 275 项存量、0 项新增，Pylint 10.00/10。此前其他票据三处 lint 问题已由集成分支修复。
- 复用 WorkbenchDetails、WorkbenchModal、WorkbenchButton、ReferencePreview 和 SourceInspector。图投影与界面只读查看不改变生成硬门槛、绑定或历史输入；架构和操作说明同步。

截图、结果与日志另保留主仓库 `front/test-results/instruction-video-06/`（ignored，不提交，排除 SQLite 和缓存），供集成与工作树归档后查阅。综合 workbench 验收由集成阶段统一执行。
