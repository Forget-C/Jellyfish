# 集成验收记录

验收范围为已确认规格的 A01–A20；自动化使用受控供应商边界，真实生成另见 [四种模式记录](./real-generation.md)。候选登记、人工采用和实际动作覆盖仍分别表达。

| 验收项 | 主要证据 |
| --- | --- |
| A01 导航保留与硬门槛 | 01 的 instruction-design / instruction-preparation 浏览器用例 |
| A02 AI 明确生成、预览及应用 | 01 instruction-design；08 candidate-refresh 集成链路；真实生成记录 |
| A03 选段与迟到结果保护 | 01 instruction-suggestions / instruction-evidence 回归 |
| A04 当前指令卡检查与生成 | 02 instruction-card 浏览器；指令检查与 scene_video HTTP 用例 |
| A05 首尾帧、分组空态和实际绑定 | 03 frame-inputs；04 reference-source；图投影 HTTP |
| A06 目标范围、取消与撤销 | 03/04 按卡浏览器和 HTTP 范围验证 |
| A07 同图独立首尾帧 | 03 frame-inputs 与真实 Worker 媒体回归 |
| A08 主体组多图与对象用途 | 04 reference-source / reference_group_generation |
| A09 模型不支持时不降级 | 03/04 诊断定位、固定角色选择器与模型校验 |
| A10 已采用区间实际落幅承接 | 05 前段依赖 HTTP 与真实末帧浏览器流程 |
| A11 明确比较替换和取消 | 05 首帧／前段原子替换浏览器流程 |
| A12 解绑后声明待绑定 | 05 pending 状态、保存与生成阻塞回归 |
| A13 历史多前段及明确移除 | 05 新增多前段拒绝、历史原样保存与收敛 HTTP |
| A14 只读输入与精确回跳 | 06 instruction-inputs 图投影和浏览器 |
| A15 冻结输入至供应商 | 03/04 真实 TaskWorker→HTTP 边界核对 PNG 字节、顺序及主体组；四模式真实视频 |
| A16 文件和来源异常 | 03/04 缺文件不得发请求；05 伪造落幅、失效与版本冲突事务用例 |
| A17 运行期间变化不改任务 | 02/03/04 固定输入；07 candidate-refresh 旧依据候选 |
| A18 候选刷新而不自动采用 | 07 candidate-refresh；08 AI 起草至人工采用集成流程 |
| A19 核实、取消、重试及重复结果 | 既有场次 video HTTP、指令恢复与重复登记用例；07 保存待核实轮询 |
| A20 键盘、只读与窄屏 | 各票据 1440/390 截图、焦点恢复及标准 workbench 套件 |

## 集成检查

- 后端全量：`S3_BUCKET_NAME=browser-test-storage S3_PUBLIC_BASE_URL=http://storage.test uv run --no-sync pytest -q`，856 passed、19 skipped（209.19s）。隔离工作树不加载真实 S3 配置，使用虚拟 URL；此前的三项 URL 构造失败在该配置下复核通过。19 项既有跳过不计为通过。
- `pnpm --dir front run typecheck` 通过；`lint:check` 为 275 项存量、0 项新增；`test:unit` 全部通过；后端 `uv run pylint app` 为 10.00/10。
- 标准 `test:workbench-ui` 六项全部通过（workbench-ui/style、design-scope、unit-design、instruction-preparation/design）。
- `instruction-video` 已通过 instruction-card、frame-inputs、default-assets、reference-source、frame-dependencies、instruction-inputs、candidate-refresh；scene-video 旧导航及模型夹具迁移后单独通过（61.0s）。原始套件失败记录保留，复跑不覆盖历史。
- 原视频恢复回归复现了自己的待核实保存被证据刷新误判为外部冲突；刷新延后并在核实后补读，scene-video 61.0s 转绿。修复后 candidate-refresh 24.4s、periodic-save 10.6s 通过，后者仍验证真正的外部保存冲突。
- 最终截图、原始日志和逐用例结果保存在主工作区 `front/test-results/instruction-video-08/`，排除 SQLite 和缓存。四种真实视频独立保存在 `instruction-video-real/`。
- 实施与上述验证均已完成，双轴代码审查进行中。

逐票红绿和证据详见 issues 01–07；已有成功结果只在相关实现变化后重跑。
