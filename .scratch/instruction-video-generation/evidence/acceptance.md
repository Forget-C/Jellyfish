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

待最终集成填写命令及结果。逐票红绿和证据详见 issues 01–07；已有成功结果只在相关实现变化后重跑。
