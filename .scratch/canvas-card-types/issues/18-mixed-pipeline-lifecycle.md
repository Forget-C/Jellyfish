# 18: 混合管道运行与引用生命周期

**What to build:** 用户在模型、参考卡和导演卡组成的管道中运行到目标或执行选定范围，明确输入、固定依据与结果去向；重开和删除操作不会改变已有采用或历史。

**Blocked by:** [03 约 1 秒自动保存与下游刷新](03-autosave-output-refresh.md)、[09 多角度参考与视频名称映射](09-multi-view-video-mapping.md)、[10 人物表演与情境生成](10-performance-direction.md)

**Status:** ready-for-agent

**Completion:** integrated

- [x] 在已交付类型上打通图片生成到参考卡再到视频生成、对象参考到表演再到模型等混合链路；全部候选边统一无环，逐卡只消费直接明确输出。
- [x] 按实际采用组织执行依赖和范围，保留既有运行到目标、严格框选及范围占用规则；未采用候选不产生任务，参考和导演输出处理不成为隐式模型任务。
- [x] 当前输出引用与固定产物分开：已有合法当前位置可按冻结计划使用本轮上游新结果，固定参考主图不自动替换或迫使来源重跑。
- [x] 从未发布或当前缺失输出不能以计划中即将生成的承诺放行；保留失效身份与定位，不自动改用旧结果或其他候选。
- [x] 相关性按实际采用输出判断：只改人物年龄不影响仅使用命名图片的依据，改名称映射影响有关输入；改示例媒体不影响未采用该媒体的模型。
- [x] 运行受理后固定文档、绑定、范围和执行计划，下游提交前固定实际请求；自动保存、后续编辑及新输出不改写在途运行或历史。
- [x] 取消、失败、结果未明、重开与事件恢复保持真实状态和幂等，生成成功只发布结果，不自动采用、覆盖本卡或启动下游。
- [x] 在各类型已有保护之上核对混合关系的取消／替换、来源删除和文件保留；固定图可明确另存、改绑再删来源，不静默断开或制造替代来源。
- [x] 本票负责混合执行和生命周期协调，不替前序票补做其本来应交付的保存、单卡生成、无环或绑定基础保护。

规格依据：[总体规格](../spec.md)。共同约束与验证边界见[任务索引](../README.md)；本票实现与验收证据见下方 Comments；implemented 表示等待主区集成。



## Comments

- 2026-10-29：在唯一工作树 `/private/tmp/jellyfish-canvas-types-18`、分支 `codex-canvas-types-18`，从集成基线 `1b353bf7` 实施。使用已确认公开 HTTP → 真实 TaskWorker 和真实页面接缝；只替换外部供应商及对象存储，未修改任务系统或补写前序票据基础能力。
- `test_generation_canvas_mixed.py` 使用真实图片产物 → 固定命名图片 → 表演 → 视频，验证 target 仅运行实际采用的必要模型，普通参考／导演／未采用候选不创建 Task；对象年龄不进入请求且修改不使依据过期，名称改变使相关输出过期；源模型真实重跑产生新 file/result_set 不替换固定主图、不自动执行下游；新增未采用候选及候选代号重排不使实际依据过期。
- 同一 mixed HTTP → Worker 用例验证严格 selection 不能复用范围外过期来源；补选后只执行 image/video，等待视频按固定计划使用本轮新 current 图片，同时保留参考卡旧 fixed 图片。受理后的名称、表演和来源提示词编辑不改变实际供应商请求；后续编辑、正式产物与运行历史保持分离。原来源删除先返回 `REFERENCE_IN_USE`，显式另存历史图片、改绑独立内容并取消其他实际采用后可删除；原运行成果仍可读取。
- 红绿证据：新公开生命周期用例先失败在撤回模型媒体后 `precheck.can_run == true`；修正 `CanvasRuntime.current_outputs` 核验模型正式媒体文件后通过。撤回输出保留原 card/port/position 身份及保存绑定，输出标记 unavailable，预检产生 `OUTPUT_MISSING` 并不把来源未来重跑作为放行条件。既有固定内容／命名图片校验沿用。
- 后端检查：`UV_CACHE_DIR=/tmp/jellyfish-uv-cache PYTHONPATH=. uv run --no-sync pytest tests/test_generation_canvas*.py -q --disable-warnings`：**200 passed／28 skipped**；新增 mixed 切片最终 **2 passed**。已核实 `app.__file__` 位于本工作树。全画布回归包括失败／取消、回执重放、丢失取消响应、真实 Worker 恢复／事件及文件生命周期既有覆盖；不以 SQLite 结果宣称 MySQL 竞争验证通过。
- `UV_CACHE_DIR=/tmp/jellyfish-uv-cache PYTHONPATH=. uv run --no-sync pylint app`：**10.00/10，exit 0**（缓存 stats 写入受限提示不影响结果）；Node24.22.1 `pnpm --dir front run typecheck`：通过。独立8295真实HTTP导出生产 OpenAPI（去除测试控制路径）与提交 schema 精确一致；重新 `openapi:gen` 后只有394处纯尾空行漂移，已剔除，无 generated client 实质变化。没有从主区8000生成。
- 真实页面：统一入口 `PLAYWRIGHT_CHANNEL=chrome node front/tests/run-browser.mjs generation-canvas-mixed --output /private/tmp/canvas18-browser-pass`：**PASS preflight／PASS generation-canvas-mixed (6.8s)**。实际图片模型产物先固定为参考，页面采用表演设计和命名图，运行到此处仅生成 consumer，预检显示直接表演／名称映射，保存重开保留采用，1440px／390px截图已检查；证据 `/private/tmp/canvas18-browser-pass/generation-canvas-mixed`。首次默认 Chromium 未安装，改用本机 Chrome；首轮 Chrome 因测试在重开后没有等待异步输出而失败，增加 waitFor 后转绿，非产品修复。
- 共享工作台控件、主题、布局均未修改；按实际影响复用前序票据共享验收，新 mixed 页面独立验证，不额外重跑无关六例。28项MySQL／其他可选环境跳过、受控供应商／外部存储限制保留，不证明真实供应商质量。

- 完成前合入最新集成 `e00192ac`（12摄影已集成）。仅README并行实施记录冲突，双方事实均保留；runtime正式模型媒体有效性修复完整保留，未覆盖12的typed摄影payload、scope投影或图片目标选择。合后针对真正交叉影响执行 `pytest tests/test_generation_canvas_mixed.py tests/test_generation_canvas_photography.py -q`：**19 passed**，覆盖图片／文本／视频真实Worker、摄影所选范围相关性、阶段目标及整卡表演规则；Node24 typecheck通过。混合真实Chrome统一入口再次通过（**8.1s**），证据 `/private/tmp/canvas18-after12/generation-canvas-mixed`，窄屏截图已复核；独立8295生产schema与最新提交OpenAPI精确一致。相同本地runtime实现的Pylint10及200/28全画布结果复用，不无谓重跑已过基础。

- 2026-10-29：主区依次集成14（`9678a1f0`）及18（`99659847`），仅README和浏览器套件列表冲突，保留双方新增记录及入口；Completion更新为integrated。合后叙事／混合／摄影／空间／声音／表演HTTP与真实Worker组合 **108 passed**（10.76s），Node24.22.1 typecheck通过，`git diff --check`通过；复用14全画布232 passed／28 MySQL skipped、Pylint10.00/10及两票真实页面证据。主区 `app.__file__` 已确认，当前生产app导出与提交OpenAPI精确一致（`/private/tmp/canvas14-18-integrated-production.json`）。8000父进程73854仍属当前主backend，但升级权限的urllib20／30秒与绕过代理curl10秒均无响应；未终止用户服务，标准 `openapi:update` 留待该服务恢复后复验，不从旧进程覆盖已同步契约。供应商／存储替身和MySQL缺环境边界保留。
