# 11: 空间锚点与空间调度

**What to build:** 用户建立场所内的锚点、人物站位走位和镜内活动，完整采用空间设计进行生成；参考示意与实际模型媒体输入分开。

**Blocked by:** [10 人物表演与情境生成](10-performance-direction.md)

**Status:** ready-for-agent

**Completion:** integrated

- [x] 四类工具按规格保留稳定身份、位置方位、空间关系、尺度、朝向、路径、主动权、延迟、入出画、结束状态及活动／留白说明等适用字段。
- [x] 锚点位于导演工具箱的表演与调度，可先用文字建立再关联图片标记；替换参考素材不改变锚点身份。
- [x] 所属空间、参与对象、位置锚点、区域锚点和作用对象仅从直接且类别匹配的候选选择；选择场所身份不读取场所正文或图片。
- [x] 空间锚点提供明确对象引用供调度选择，站位与走位提供调度对象供后续镜头引用；名称与身份不变成跨级读取许可。
- [x] 变化事件与触发事件按各自用途声明可选关系，后续事件来源接入时不合并成一种关系，也不自动推导触发行为。
- [x] 设计默认完整采用，可直接生成文本或视频；位置设计需要锚点全文或示意媒体时，模型须分别直接连接并采用。
- [x] 素材关联按类型限制图片／视频等允许范围和定位，不自动成为生成首尾帧；关系、输出和文件保护随保存重开保持。
- [x] 未填写非必要关系不阻断独立有效生成；自由描述不用于猜测同名锚点、参与对象或自动补齐阶段。

规格依据：[总体规格](../spec.md)。共同约束与验证边界见[任务索引](../README.md)；以下实施记录区分真实验证与外部环境限制。



## 实施记录

- 工作树 `/private/tmp/jellyfish-canvas-types-11`，分支 `codex-canvas-types-11`；从 `567b3e04` 开始。代码 `a2330d3a`，无冲突合入最新集成 `c8e88301` 得 `6248aa71`，保留服装参与者资格修复；未推送或操作主区服务。
- 四种强类型卡及专用详情／摘要：`direction.anchor`（稳定 `anchor_id`、名称、位置、方位、关系、尺度）、`direction.blocking`（稳定 `blocking_id`、名称、位置、朝向、主动权、路径、切换原因）、`direction.activity`（任务、注意对象、主戏作用、路径、延迟依据／毫秒、入出画、结束状态、景深层次、强度）、`direction.environment`（环境活动、留白、理由）。锚点与调度独立发布仅含身份名称的引用出口，整卡文本包含本卡强类型字段与明确关系用途；不携带祖先正文或媒体。已建立身份不能静默改绑。
- 空间／参与者／位置锚点／区域锚点／作用对象只接受直接且类别匹配的具体身份，单对象关系按实际身份计数。参与者允许人物、服装、道具，不允许场所；变化／触发事件用途分别声明，待14真实来源接入，不伪造候选。场所名称、锚点引用不授予跨级读取许可。文本可分析未完成设计；视觉生成采用走位／镜内活动时须明确参与者，锚点和环境活动可独立生成，不要求镜头或节拍。
- 图片／视频素材复用固定文件、项目归属、删除保护和递增视频区间；锚点图片以归一化点标记。换源图不会替换固定文件，明确替换参考不改变锚点身份。素材不成为首尾帧或随设计输出。所有候选关系继续统一无环。
- 红绿记录（已确认HTTP接缝）：未知空间类型保存422→文字锚点／走位保存与编译通过；活动／环境类型422→全部字段完整输出；未知markers字段422→固定图片标记保存／重开／替换通过；既有身份可改绑200→明确422保护；视觉动作缺少主体诊断→明确要求参与者，文本分析仍可用。类别／数量、区间、无环及整卡文本／真实TaskWorker文本和视频路径覆盖在 `test_generation_canvas_spatial.py`，供应商HTTP及外部存储使用受控替身。
- 最终全部画布后端：`PYTHONPATH=. UV_CACHE_DIR=/private/tmp/canvas11-uv UV_PROJECT_ENVIRONMENT=/Users/extreme/Projects/github.com/jellyfish/backend/.venv uv run --no-sync pytest -q tests/test_generation_canvas*.py` → **173 passed / 28 skipped**；28项MySQL专用覆盖缺少 `JELLYFISH_TEST_MYSQL_URL`，不声称真实MySQL通过。本票20例均通过，包含真实Worker文本／视频。
- `uv run --no-sync pylint app`（同上app路径／环境，`PYLINTHOME=/private/tmp/canvas11-pylint`）→ **10.00/10**；Node24.22.1 `pnpm --dir front run typecheck` 通过；工作区、暂存区及相对集成差异检查通过。
- 公开schema已从核实为本工作树的 `app.main.app.openapi()` 独立导出，运行 `pnpm --dir front run openapi:gen` 同步generated client，并剔除纯末尾空行漂移。不从主区8000获取未合入契约，不停服务；不声称对8000执行标准openapi:update。
- 真实Chrome：`generationCanvasSpatial.browser.mjs` 在独立8287／4287及case专属Vite缓存运行通过；文字锚点、所属空间／位置锚点选择、四类设计编辑、图片关联与坐标标记、约每秒自动保存、下游整卡采用与不穿透编译、重开及1440px／390px无横向溢出。证据 `/private/tmp/canvas11-browser-final`（`anchor-marker.png`、`spatial-desktop.png`、`spatial-mobile.png`），已人工查看截图。
- 工作台六例均通过：workbench-ui4.8s（`/private/tmp/canvas11-workbench`）、workbench-style71.4s（`/private/tmp/canvas11-style-isolated`）、design-scope15.1s（`/private/tmp/canvas11-scope-isolated`）、unit-design28.7s／instruction-preparation10.8s／instruction-design16.4s（`/private/tmp/canvas11-workbench-remaining`）。首轮style纯白页、scope tooltip等待失败；独立集成基线style通过71.8s（`/private/tmp/canvas11-baseline-style`），本工作树在安静环境及独立Vite缓存中有界复验通过，日志无pageerror或优化依赖404。共享node_modules缓存与当时HMR是环境疑点，未确认根因；失败证据保留，不冒充首轮通过。为受影响case增加独立cacheDir及失败日志，未修改业务逻辑规避检查。
- 验证限制：不评估真实供应商视觉质量或外部对象存储；14事件来源、镜头调度采用及12图片明确多阶段目标的组合由后续票据接入，本票不新增猜测阶段。

- 主区集成：2026-10-28 无冲突显式合并 `58f19865` 得 `9cb75002`，主区空间／表演 HTTP及真实文本／视频Worker **47 passed**（4.14s）、Node24.22.1 typecheck通过。主区app导入已核实，生产导出／8000 HTTP／提交schema精确一致并含空间引用字段后，标准 `openapi:update` 成功；390处纯尾空行漂移已剔除。全部画布173／28、Pylint10及空间真实页面／共享六例复用同一实现上述证据和失败复测限制；未操作其他票据工作树或共享浏览器验证环境。
