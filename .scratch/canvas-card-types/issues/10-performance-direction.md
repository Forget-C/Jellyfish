# 10: 人物表演与情境生成

**What to build:** 用户从文本对象或命名图片参考选择参与对象，编写情境、表演和规则，按完整卡片采用后直接生成文本或视频。

**Blocked by:** [06 视频生成的用途与实际采用](06-video-generation-inputs.md)、[08 四类命名图片参考](08-named-image-references.md)

**Status:** ready-for-agent

- [x] 三类卡片保留规格完整字段，使用专用摘要与展开详情；人物表演先呈现触发、反应、动作和结束状态，背景、细节与约束可继续编辑。
- [x] 参与对象与作用对象从直接对象引用按类别明确选择；独立图片参考可直接提供人物身份，不要求先建立描述卡，也不携带其主图。
- [x] 人物表演的参与对象、目标、目光、身体动作等形成完整设计输出，多张表演卡逐卡采用，不提供单项勾选或自动补齐的局部采用机制。
- [x] 在首条导演链路落实字段状态及背景／设计／约束用途：空值与不适用不生成要求，明确没有保留否定，提议／待确定不升级成硬要求或自动确认。
- [x] 本卡设计和必要对象标识直接进入文本／视频生成；模型需要人物描述或图片时须分别直接采用，不沿业务引用或素材关联追读。
- [x] 允许从直接图片、视频等候选按本类型字段声明关联示例并定位用途／有效区间；示例只供当前卡参考，不随文本输出传给模型。
- [x] 没有镜头或节拍也能独立使用；声明后续所属节拍、接收事件、对白依据和验收依据的可选契约，不伪造来源或把完整导演计划作为前置条件。
- [x] 卡片字段、采用、输出与诊断可保存重开；本票已有关系即完成统一无环、失效绑定及素材删除保护，不把基础保护留给混合运行票据。
- [x] 图片的结构化目标状态交互由摄影与图片目标状态票据接续；本票不临时拆分表演字段来绕过完整采用规则。

规格依据：[总体规格](../spec.md)。共同约束与验证边界见[任务索引](../README.md)；本票已实现，验证证据与限制见下方 Comments。



**Completion:** integrated

## Comments

- 2026-10-28：在 `codex-canvas-types-10`（`/private/tmp/jellyfish-canvas-types-10`）从已核实集成基线 `acdbf7be` 实施；仅本票三类设计卡，不接后续节拍／事件／对白／验收来源和图片目标选择。
- 具体卡类型为 `direction.situation`、`direction.performance`、`direction.performance_rule`，专用摘要／步骤／详情及共享同语义字段控件；字段、状态、背景／设计／约束、范围／阶段／条件和来源由强类型契约保存。`DesignTextPayload` 只发布一个完整 `text` 出口，明确 `whole_card`，不提供目光／身体动作单项出口；派生输出只由后端形成，保存不调用模型。
- `participant` 仅接直接明确的人物／服装／道具，真实身份计数至多一个；`effect_object` 用于相关人物、物件、服装、场所。独立命名参考可直接提供稳定对象，无需描述或主图；输出不读取上游描述、图片或示例。可选后续接收端点为 `beat`、`received_event`、`dialogue_basis`、`acceptance_basis`，当前不虚构来源或必填绑定。
- 图片／视频示例固定具体文件，保存正向／反例用途与说明，视频支持递增毫秒区间；示例不随设计文本传给模型，源文件替换不改变已选示例；`canvas_content` usage 保护删除。对象及示例共用统一无环、实际引用保护和最终文档校验。
- TDD 红绿：HTTP 初始完整设计保存失败（未知卡类型）→通过；明确对象数量／类别／身份四个拒绝行为原先错误受理→通过；示例删源保护与视觉主体诊断原先失败→通过；源媒体替换后的下一次保存原先错误拒绝→固定文件后通过。页面截图发现 UUID 重复取消按钮，新增真实页面回归先失败（1 != 0）再修复为唯一按名称操作。纯文本不语义纠错；所有六种显式状态、十五项表演字段、非法局部出口、统一环、异常区间、示例文件释放及完整文本／视频 Worker 请求均经 HTTP 验证。
- 后端全画布 `141 passed, 27 skipped`（17.51s），随后补充异常区间和示例唯一文件保护检查，本票独立 `23 passed`（2.17s）。真实文本与视频 TaskWorker 均核对完整设计的供应商请求、成功归档与当前结果，不含祖先描述；外部供应商与对象存储采用受控替身。MySQL 专用 27 项因缺环境跳过，不计通过。
- `PYTHONPATH=. UV_CACHE_DIR=/private/tmp/canvas10-uv uv run --no-sync` 已核实导入本工作树 app。公开 OpenAPI／generated client 已同步；隔离 8285 实际 HTTP 导出剔除 fixture 控制路径后与生产 `front/openapi.json` 精确一致，证据 `/private/tmp/canvas10-browser-8/openapi-production.json`。未操作主区 8000；合入主区后由集成流程执行标准 `openapi:update`。已剔除生成器无关纯尾空行漂移。
- 真实 Chrome 页面（8285／4285）三类专用编辑、对象明确采用、一秒保存、显式“明确没有”、整卡采用、预检、真实 Worker 出图、重开和窄屏无横向溢出通过；截图已人工查看：`/private/tmp/canvas10-browser-8/performance-desktop.png`（1440px）与 `performance-mobile.png`（390px）。未测量真实供应商质量。早期未安装 Playwright 默认浏览器，改用本机 `PLAYWRIGHT_CHANNEL=chrome`；两次新增 AntD 状态交互测试因定位隐藏虚拟选项失败，修正为可见选择器和文本后通过，不将失败记录计作通过。
- 前端 Node 24.22.1 `pnpm --dir front run typecheck` 通过。共享工作台 `test:workbench-ui` 的 preflight／workbench-ui 通过；首次 workbench-style 因 4193 临时占用阻断，已与09协调只重试该项并通过（71.1s），证据 `front/test-results/browser-DyeaQB`，其他未受影响共享六套复用09／08同组件证据。普通字段使用 AntD，动作与详情复用既有 WorkbenchButton／WorkbenchDetails，无样式例外。

- 最终收口：只简化已发布设计的主体诊断并使定位指向真实绑定身份，受影响设计／编译 HTTP `27 passed`（2.05s）、Pylint `10.00/10`（stats缓存路径权限提示不影响 exit 0）通过；前端 typecheck、工作区差异检查通过。

- 2026-10-28 主区集成：无冲突合并 `7961350b`，显式合并提交 `f13e5ccd`。主区 `PYTHONPATH=. UV_CACHE_DIR=/private/tmp/canvas10-uv uv run --no-sync` 已核实导入当前 backend/app；本票 HTTP／真实 Worker 回归 `23 passed`（1.94s）、Node 24.22.1 typecheck 通过。8000 监听父进程 `73854` 的 cwd 为主区 backend，实际 HTTP schema 包含三类新导演卡与 `DesignTextPayload`，与本票生产 OpenAPI 精确一致；标准 `pnpm --dir front run openapi:update` 成功，379 处纯尾空行漂移经逐文件与 HEAD 核对后剔除，无契约漂移。复用上述同一实现的 Pylint、全画布与真实页面证据及其限制；未推送、未操作09工作树。

- 2026-10-28接续09后的组合验证：`d20271fb` 保留本票完整设计发布、主体诊断及所有字段，与09实际视频用途映射共同通过相关HTTP／Worker `64 passed, 2 skipped`（7.32s）、Pylint `10.00/10`、标准OpenAPI更新后的Node24.22.1 typecheck；当前生产导出与8000 HTTP精确一致。

- 2026-10-28规格审查修正：`participant` 资格包含人物、服装、道具。新增直接服装文本／独立服装参考 × 情境／表演四个 HTTP 用例，先均因 `INVALID_DESIGN_CATEGORY` 失败，再只补后端资格与前端对应过滤后通过；完整本票 `27 passed`（2.40s），继续覆盖场所拒绝和人数上限，服装只传身份／名称不读取描述或图片。Pylint `10.00/10`（stats缓存写入提示不影响exit0）、Node24.22.1 typecheck及差异检查通过。未改变公开schema，不重新生成接口。

- 修正提交 `440e5372`；报告前合入最新集成 `567b3e04`，合并提交 `2c46f189`，仅票据追加记录冲突并保留双方证据，Completion 维持 integrated。09 映射三字段／serializer 与实际用途内顺序均保留；合并后情境表演／命名参考／视频 HTTP 与 Worker 回归 `68 passed, 2 skipped`（6.87s），Node24.22.1 typecheck 通过。未修改公开契约、未操作主区或推送。
