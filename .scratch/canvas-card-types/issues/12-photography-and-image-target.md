# 12: 摄影设计与图片目标状态

**What to build:** 用户在一张摄影内容卡中编辑画面设计，按声明范围采用；图片模型可为已有结构化阶段指定画面目标，同时保持表演等设计完整采用。

**Blocked by:** [10 人物表演与情境生成](10-performance-direction.md)

**Status:** ready-for-agent

**Completion:** implemented

- [x] 构图、机位、运镜、光影和焦点入口编辑同一张摄影内容卡；不创建多张可编辑投影同步隐藏对象，也不因所属镜头相同自动合并独立方案。
- [x] 保留规格中的摄影字段、状态、用途和必要关系，支持专用摘要与详情编辑；没有镜头仍可独立使用，所属镜头按可选对象输入声明。
- [x] 摄影输出明确列出允许完整或局部采用的区域、字段／状态及动态条目；选择保存稳定标识，改名或重排不改变所指范围。
- [x] 仅采用运镜后新增光影不扩大输入；字段清空与条目删除分别处理，合法空值不强制改绑，失效条目不得回退旧值。
- [x] 图片模型可从已采用导演输出明确提供的结构化阶段／状态选择画面目标；对人物表演等整卡输出保留全部设计，仅增加本张图的目标配置。
- [x] 不从普通文本或动作自由描述推断阶段并强制选择时刻，不为此新建阶段字段；明确结构化多阶段的必要目标校验按规格处理。
- [x] 文本、图片和视频编译保留背景、设计、约束与状态；只对同一明确目标／状态下必须同时满足的已知互斥结构要求诊断，开放提议不当作硬冲突。
- [x] 摄影直接对象、参考素材和后续验收／镜头关系遵守一跳与统一无环；关联示例不自动进入生成。
- [x] 手工编辑到保存、采用、编译预览、图片／视频生成构成可用链路；可视化预设在下一票扩展，不以占位选项替代本票编辑能力。

规格依据：[总体规格](../spec.md)。共同约束与验证边界见[任务索引](../README.md)；本票执行已确认的 HTTP 与真实页面接缝；实现与检查证据记录于 Comments。


## Comments

- 2026-10-28：在独立工作树 `/private/tmp/jellyfish-canvas-types-12`、分支 `codex-canvas-types-12` 实施，起点 `567b3e04`；后续显式合入 `c8e88301`、`3ce05ff0` 和 `1b353bf7` 的最新集成事实。分诊 Status 保持不变，Completion 仅表示本票实现完成，待父任务集成。
- 按已确认的 HTTP 与真实页面接缝执行 TDD。首个 HTTP 用例先因未知摄影类型／范围而 422；随后逐行为出现并修复图片缺目标诊断、结构化景别无自由正文时漏编译、未选焦点关系扩入运镜、其他明确状态的硬要求错误阻断，以及表演／镜内活动已有结束状态未声明目标。后端新增 17 个摄影 HTTP／真实 Worker 用例；只替换外部供应商与存储，不替换画布编译、保存或 Worker。
- 实现一张 `direction.photography` 内容卡五区编辑，保留全部摄影字段、显式状态／用途／来源、对象关系和固定正反例及字段定位。`PhotographyTextPayload` 声明完整／区域／字段／阶段的稳定范围；绑定只记录声明 ID，不解释任意 JSON 路径。合法清空保留身份，删除阶段使选择失效；局部投影同时覆盖 `used.payload` 和 `used.text`，真实文本／图片／视频 Worker 均验证未选光影变化不使成果过期，已选运镜改变会过期。焦点／关注对象按实际区域保留，一跳身份不跨级携带描述或示例。
- 图片 `frame_targets` 与采用记录分开，保留完整设计。摄影只从明确起止画面或本卡明确阶段提供状态；表演／镜内活动复用既有 `exit_state`，不解析普通文字或添加通用导演阶段。多状态静帧要求明确目标；目标失效不回退。硬冲突仅比较同一显式目标／状态上的已知单值事实设计或约束，提议、待确定、背景、自由正文和其他所选状态不升级为硬冲突，不自动筛选采用范围。
- 真实页面先确认摄影入口数量为 0，再完成五区录入、约一秒自动保存、重开、单卡计数、明确运镜采用、结束画面目标、预检与真实图片 Worker、显式复制独立方案。页面发现保存刷新卸载候选区而使目标下拉消失，修复为同卡刷新保留上一已保存数据与控件，切卡不串数据；新增真实页面回归证明打开的目标下拉跨自动保存保持。共享 `DesignFieldEditor`／`DesignMediaExamples` 仅抽取相同字段语义，示例按卡声明的端点接受模态，保留15音视频区间和文件保护。
- 最终合并后，`PYTHONPATH=. UV_CACHE_DIR=/private/tmp/canvas12-uv uv run --no-sync pytest -q tests/test_generation_canvas_*.py`：**215 passed, 28 skipped**（23.31s）。MySQL 未配置而跳过的 28 项不计通过；SQLite 功能与真实 Worker 不证明 MySQL 并发。`uv run --no-sync pylint app`：**10.00/10，exit 0**（仅本机 stats 缓存写权限提示）。Node `24.22.1` 的 `pnpm --dir front run typecheck` 通过，差异检查通过。
- 使用本票隔离 `8289` 服务导出当前生产 OpenAPI（测试控制端点不进入 schema），逐项与当前 `app.main.app.openapi()` 精确比较；确认摄影、空间、声音、对白依据与图片目标均保留后执行 `pnpm --dir front run openapi:gen`。保留09 `NamedImageMapping` 三个 optional 字段及 None serializer；还原389处仅尾空行的无关生成漂移。本票未从主区8000生成，也未停止主区服务。
- 最终自动化真实页面三项全部通过：摄影 **10.1s**、表演 **13.0s**、对白声音 **11.8s**。证据目录 `/private/tmp/canvas12-page-merge/`，摄影包含 `photography-preview.png`、`photography-results.png`、`photography-desktop.png`、`photography-mobile.png` 与 `submitted-text.txt`；桌面1440px、窄屏390px无详情横向溢出。注册 `generation-canvas-photography` 浏览器用例并加入 generation 套件。手动验收图片供应商固定返回3张，最初 count1触发真实数量拒绝，改用fixture所需count3后完整成功；不将该fixture限制当作产品缺陷或真实供应商质量证据。
- 共享工作台规定检查已串行完成：workbench-ui **4.6s**、workbench-style **72.2s**、design-scope **15.4s**、unit-design **29.3s**、instruction-preparation **10.5s**、instruction-design **17.0s**。证据 `/private/tmp/canvas12-workbench/` 与 `/private/tmp/canvas12-workbench-rest/`。首次style因我在测试期间重新生成客户端而被HMR导航打断，不计通过；固定生成文件后重跑上述受影响及未完成五项均通过。各例沿11相同的独立Vite缓存隔离；不将缓存隔离当成根因证明。结束后已释放全部共享端口。
- 范围边界：`shot`／`acceptance_basis` 仅声明可选接收端点，14／17来源的真实组合由对应后续票据接入，19核对；未伪造镜头或验收对象，不以缺少镜头阻止独立摄影。可视化预设与独立画面风格由13实现，本票无占位预设。未推送、未编辑主工作区、未开展后续票据。
