# 14: 叙事与镜头设计

**What to build:** 用户组织叙事概览、节拍、事件和镜头设计，明确关联人物与调度，再将完整设计用于生成；不创建完整场次计划。

**Blocked by:** [11 空间锚点与空间调度](11-spatial-direction.md)

**Status:** ready-for-agent

**Completion:** implemented

- [x] 四类工具保留观察视点、信息／人物关系变化、转折、行动目标、阻碍、可见结果、预计时长及待确定状态等完整字段。
- [x] 节拍、事件与镜头提供各自稳定对象引用；普通文本提到的名称不自动变成这些业务身份。
- [x] 镜头的参与对象、覆盖节拍、关联事件、调度依据按直接候选明确选择；对象数量、类别和来源按端点限制，预览不增加关系。
- [x] 新增节拍与事件来源接入既有接收方的所属节拍、接收事件、变化事件、触发事件等可选声明，保留不同用途，不跨级展开正文。
- [x] 镜头对象可提供摄影所属镜头候选；摄影接收声明与本票来源契约一致，双方交付后在组合流程核对，不要求无镜头摄影先补完整计划。
- [x] 叙事与镜头设计默认整卡输出，可直接用于已支持的文本／视频生成并向图片编译提供完整设计；明确状态按统一目标契约表达，选择交互与摄影票据在组合流程核对，不根据整场／镜头自动筛选或补齐输入。
- [x] 预计镜头时长不等于真实媒体区间，关系不代表实际覆盖或自动执行；生成结果不自动确认节拍、镜头或设计版本。
- [x] 保存重开、复制改名、删除与失效诊断覆盖本票对象和引用；验收依据由后续验收要求来源接入，不预建反向关系。

规格依据：[总体规格](../spec.md)。共同约束与验证边界见[任务索引](../README.md)。实施与验证证据见下方记录。


## Comments

- 2026-10-29：在独立工作树 `/private/tmp/jellyfish-canvas-types-14` 实现。四类卡使用专用强类型字段，沿用 `DesignField` 的状态、用途、来源及本卡范围，提供专用摘要和编辑详情，整卡输出不拆字段。节拍／事件／镜头拥有独立稳定身份引用出口；创建／改名／复制按同类名称和身份唯一校验，已建立身份不可改绑。
- 镜头参与对象、覆盖节拍、关联事件和调度依据只消费直接明确身份，多个覆盖节拍沿实际 `InputBinding` 数组顺序上下移动，保存重开保留稳定身份及顺序。表演所属节拍至多一个、接收事件可多个；走位变化事件与活动触发事件各至多一个，用途分别保留。所有候选仍进入统一 DAG；实际引用有删源／断线保护及定位失效诊断。
- 已与 12 最终实现及 15／11 集成核对：镜头 `shot` 出口 → 摄影可选单一所属镜头，只传身份／名称，不传镜头全文；镜头已有 `visible_result` 发布 `field:visible_result` 可选画面状态，图片使用统一 `frame_targets`，完整镜头内容及预计时长仍被采用。预计时长不是媒体区间，生成不改设计状态，关联不自动执行或确认覆盖。验收来源由 17 后续接入，不预建反向关系。
- TDD 红绿：未知四类保存422 → 全字段保存／输出／重开通过；既有事件／节拍接收保存422 → 四种用途明确且不穿透通过；摄影所属镜头422 → 单镜头关系与第二镜头数量保护通过；图片目标缺失诊断 → 可见结果声明并完整采用通过；真实页面缺少上移按钮超时 → 双节拍重排保存重开通过。UI 画面目标首轮使用 AntD 隐藏 `role=option` 导致点击等待失败，改为用户键盘选择后安静环境复验通过，未修改产品逻辑规避失败。
- HTTP 与真实 Worker：`PYTHONPATH=. UV_CACHE_DIR=/private/tmp/jellyfish-uv-cache uv run --no-sync pytest tests/test_generation_canvas*.py -q` → **232 passed / 28 skipped**；本票17项均通过，含文本／图片／视频真实 `TaskWorker`，仅供应商 API 和外部对象存储使用受控替身。28项 MySQL 专用测试缺少 `JELLYFISH_TEST_MYSQL_URL`，不声称真实 MySQL 已通过。使用共享虚拟环境前已核实 `app.__file__` 指向本工作树。
- `PYTHONPATH=. UV_CACHE_DIR=/private/tmp/jellyfish-uv-cache PYLINTHOME=/private/tmp/canvas14-pylint uv run --no-sync pylint app` → **10.00/10**；Node24.22.1 `pnpm --dir front run typecheck` 通过。生产 OpenAPI 从核实本工作树的独立 8293 HTTP 导出，再按已合实现从 `app.main.app.openapi()` 同步 generated client；最终 schema 与生产导出精确相等，剔除纯尾空行漂移。不从主区8000导出未集成契约，标准 `openapi:update` 留给主区集成后执行。
- 真实 Chrome 独立8293／4293：四类编辑、事件与节拍选择、双节拍重排、摄影所属镜头、图片可见结果目标及完整设计不穿透、约1秒自动保存和重开、1440／390px无横向溢出通过。桌面及窄屏截图已人工查看；最终证据路径在下一条记录。共享控件没有修改，复用 11／12 相同实现的工作台验收，新增业务交互由本票真实页覆盖。
- 验证边界：供应商与对象存储使用替身，不评估真实供应商视觉质量；17尚未交付的验收来源不声称已验证。
- 最终真实页面证据：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-generation-canvas-narrative-DuxOSI/`，`narrative-desktop.png`／`narrative-mobile.png` 已人工查看，包含双节拍顺序；同一次通过还覆盖摄影所属镜头和图片目标。公共工作台复用12六项最终证据 `/private/tmp/canvas12-workbench/`、`/private/tmp/canvas12-workbench-rest/`（workbench-ui／style／design-scope／unit-design／instruction-preparation／instruction-design均通过），公共控件未再改动。
