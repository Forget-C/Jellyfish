# 17: 创作控制、生成指导与验收要求

**What to build:** 用户编写控制、指导和验收要求，明确供镜头、表演或摄影采用；生成使用完整要求，验收规则不被误当成素材已经通过验收。

**Blocked by:** [12 摄影设计与图片目标状态](12-photography-and-image-target.md)、[14 叙事与镜头设计](14-narrative-shot-design.md)

**Status:** ready-for-agent

**Completion:** integrated

- [x] 创作控制保留发挥程度、保持项与待确定信息；生成指导保留优先级、参考要求、声音策略及禁止项；验收要求保留稳定身份与可观察判断标准。
- [x] 设计文本默认完整采用，按用途和状态参与文本、图片、视频编译；不把参考要求直接变成素材采用，也不重写用户自由文本。
- [x] 验收要求作为直接来源，由镜头、人物表演、摄影的验收依据端点明确选择；验收卡只读展示被使用情况。
- [x] 拒绝通过验收卡的作用对象建立等价反向镜头关系；未采用候选也必须无环，关联区和选择器不绕过规范方向。
- [x] 适用对象、正向示例与反例按字段资格和媒体类型选择，候选不成为本卡自身字段，示例不随文本输出传递。
- [x] 结构冲突按已知目标、状态和硬要求判断，提议／待确定不被错误升级；不做纯文本纠错或图片语义检查。
- [x] 验收要求被采用只表示提供判断标准，不写入素材审查、真实覆盖或剪辑采用结论，不扩展旧场次生产流程。
- [x] 在摄影与镜头均可用的链路核对对象指代、相关诊断、保存重开及取消／替换保护；其他已有导演功能的独立使用保持有效。

规格依据：[总体规格](../spec.md)。共同约束与验证边界见[任务索引](../README.md)；本票实现与集成验收证据见下方 Comments。


## Comments

- 2026-10-29：在独立工作树 `/private/tmp/jellyfish-canvas-types-17`、分支 `codex-canvas-types-17`，基于集成 `7354bf73` 实施，使用用户确认的 HTTP／真实页面接缝及供应商、外部存储受控替身。
- 三类专用强类型卡及完整设计输出已落地：创作控制的发挥程度／范围、保持与待定；生成指导的优先级／参考要求／声音策略／禁止项；验收要求的稳定身份和可观察标准。状态及用途原样保留，不做自由文本或图片内容纠错，不自动采用参考，不生成音频，也不写入旧场次审查、覆盖或剪辑结论。
- 验收卡通过 `criterion_reference` 只提供身份与名称，镜头／表演／摄影明确选择 `acceptance_basis`；本卡标准正文和示例不会跨级传入使用方输出。模型要采用完整标准须另行直接采用验收卡 text。只读被使用记录来自真实输入绑定，候选不计入。作用对象接受合法的对象／空间／故事身份；验收卡拒绝反向绑定镜头等使用方，所有候选仍无环。
- HTTP 逐行为 red→green：新卡保存先失败，补完整输出；验收关系端点先失败，接通三使用方并验证不可变身份；合法空间／事件作用对象先失败，再补最小前后端兼容。15项 HTTP 验证包括三模态真实 TaskWorker、直接标准与引用隔离、改名／取消／删除保护、非法反向候选、候选环、重复身份／名称、固定反例视频与区间不传递。`pytest tests/test_generation_canvas* -q` → **249 passed／28 skipped**（MySQL环境未配置）。
- 首轮真实 Chrome 编辑／关联／重开已通过；补真实拖拽候选发现 criterion 前端标签和兼容表漏项，页面 red→green 修复后，统一入口 `PLAYWRIGHT_CHANNEL=chrome pnpm --dir front run test:browser generation-canvas-guidance --output /private/tmp/canvas17-guidance-final` → **PASS／15.5s**。覆盖三类要求字段编辑、拖拽候选后明确关联三使用方、只读记录、直接标准采用、取消、保存重开与390px窄屏；截图已检查，无横向溢出。
- Node24 `pnpm --dir front run typecheck` 通过；相关 Python Pylint 为 **10.00/10**。生产 OpenAPI 从当前工作树 `app.main.app.openapi()` 导出并生成客户端，保留单行文件格式、剔除纯尾空行漂移；主区标准8000更新待集成后执行。未修改共享工作台UI、旧场次入口或主题tokens，复用前序共享验收证据；本票三个真实使用方已独立验证，不重跑无关旧场次套件。真实供应商质量、实际外部存储及MySQL并发未被替身结果代表。

- 完成前合入最新主区 `fb1f95d2`（13风格预设及16连续性事实均已集成）。保留所有强类型字段联合、摄影预设、约束与要求的专用编辑及浏览器入口；作用对象兼容合并16合法引用范围，同时保留验收卡拒绝反向镜头的限制。合后全画布 **271 passed／28 MySQL skipped**（32.94s），Node24 typecheck、`uv run --no-sync pylint app` **10.00/10**、`git diff --check`通过。统一真实Chrome要求卡入口再次 **PASS／15.7s**，证据 `/private/tmp/canvas17-after16-guidance`，桌面／窄屏截图已复核。当前工作树 `app.__file__` 已确认，生产 `app.openapi()` 与提交 OpenAPI 精确一致；主8000标准更新留给合入17后的主区执行，不用仍不含17的主服务覆盖本票契约。

- 2026-10-29：主区无冲突集成17（分支 HEAD `3f84c01b`，合并提交 `d860ad66`），Completion 更新为 integrated，分诊 Status 不变。合后指导／连续性／叙事／摄影 HTTP 与真实 Worker 组合 **66 passed**（6.91s）、Node24.22.1 typecheck、`git diff --check`通过；产品代码与已验证分支一致，复用相同实现全画布271 passed／28 MySQL skipped、Pylint10及真实Chrome证据。主区 `app.__file__` 已核实；当前生产导出、8000实际HTTP与提交schema精确一致，含 `AcceptanceCriterionCard`。标准 `pnpm --dir front run openapi:update` 成功，432处纯尾空行漂移经精确字节核对后还原，schema等价的JSON格式漂移亦还原。生产及HTTP证据分别为 `/private/tmp/canvas17-integrated-production.json`、`/private/tmp/canvas17-integrated-http.json`。外部服务受控替身及MySQL缺环境限制继续保留，未声称真实供应商质量已验收；未推送。
