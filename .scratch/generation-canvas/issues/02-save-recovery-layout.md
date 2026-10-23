# 02: 自动保存、恢复保护与独立布局

Status: ready-for-agent
Blocked by: 01

**What to build:** 用户持续编辑或关闭重开画布时，自动保存、冲突与恢复保护内容；布局独立记忆，迟到回包不撤销新输入。

**依据：** [实现规格](../spec.md)；[任务依赖与共同验证](../README.md)。验收覆盖：A03、A04。

## Acceptance criteria

- [x] 默认每五秒检查未保存内容；手动与自动保存进入同一串行队列，保存中仍可继续输入。
- [x] 请求快照 A 发出后输入 B，A 返回只推进已保存基线，B 保留且仍待保存；运行信息与布局不触发业务保存。
- [x] 临时失败保留当前编辑；结果未知时核实或原样重放原请求，不混入后来编辑、不换新请求制造重复保存。
- [x] revision 冲突显式处理，保留本地内容；本地恢复先核实服务器及未明回执，不盲目覆盖。
- [x] 复用离开保护与编辑所有权行为，按项目／画布隔离存储键、请求及所有权；不复用场次版本 ID 或全场次业务状态。
- [x] useGraphLayout 按画布保存位置、尺寸和视角，不推进内容修订；内容刷新、浮层开合不重置布局。
- [x] 浏览器存储不可用、加载失败与恢复失败显示真实状态，不虚报已保存，不新增独立草稿或撤销体系。

## Validation

- 使用既有 periodic-save／canvas-graph 浏览器 harness 验证串行、丢回包、迟到回包、继续输入、冲突、离开和重开。
- 验证两画布及两个标签的隔离与编辑所有权；布局变化不产生内容保存请求。
- 若提取共享保存行为，回归原场次工作台相同保存流程。
- 执行 [共同检查要求](../README.md#共同检查要求) 中适用于本票变更的命令，并记录真实结果。

## Scope and handoff

提供画布编辑控制器的保存与恢复公共行为；后续预检必须等待当前快照保存，不能直接取最近服务端版本运行。

## Comments

- 2026-10-23：依据已确认术语和 ADR 建立实现票据，尚未开始实现或执行验收。


- 2026-10-23：保存与恢复实现完成（集成布局验收待 04 图组件汇合）。`useGenerationCanvasEditor` 保持当前编辑与服务端基线分离，默认五秒检查，手动/自动共用串行 flush；未明请求保留原 ID/快照并在重开时原样重放后核对服务端，冲突显式保留本地。复用浏览器所有权协议并参数化项目/画布作用域，场次默认键不变；离开先保存，未核实请求阻止放弃。
- 2026-10-23：TDD red 证据：原页面在挂起保存回包时禁用画布名称，`generation-canvas-save` 超时于继续输入，`/private/tmp/jellyfish-generation-canvas-02/front/test-results/browser-Z7UOWp`。green：`node front/tests/run-browser.mjs generation-canvas-save` PASS（12.4s）；真实页面与 generated client + 隔离后端验证迟到回包、串行补存 B、丢回包已提交 A 后重开核实并保留 B、CAS 冲突、两标签交接/两画布隔离、五秒自动保存、存储异常提示及切换前保存。证据 `/private/tmp/jellyfish-generation-canvas-evidence/02/save-recovery-ownership`。
- 2026-10-23：`pnpm --dir front run typecheck` PASS；`node front/tests/run-browser.mjs periodic-save` PASS（10.3s）；`node front/tests/run-browser.mjs canvas-graph` PASS（25.4s）。原功能证据 `/private/tmp/jellyfish-generation-canvas-evidence/02/original-periodic-save`、`/private/tmp/jellyfish-generation-canvas-evidence/02/original-canvas-graph`。最小共享改动仅为所有权可选作用域和 useGraphLayout 可选存储错误回调；未改变后端契约。
- 2026-10-23：剩余布局验收由并行 04 的真实 GenerationCanvasGraph 使用 useGraphLayout 完成：位置/尺寸/视角重开保留、内容刷新和浮层不重置、布局变化无业务 PUT。未提前勾选该项；最终集成后补证据。

- 2026-10-23：04 已在真实 GenerationCanvasGraph 完成剩余布局验收：位置移动、原生宽高调整、视角缩放在刷新后恢复；等待超过自动保存周期仍无内容 PUT；内容输入顺序及分组编辑不重置已存布局。`generation-canvas-graph` PASS（12.9s），证据 `/private/tmp/jellyfish-generation-canvas-evidence/04/typed-graph-final`。本票全部验收已完成。
