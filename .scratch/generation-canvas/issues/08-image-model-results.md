# 08: 图片模型的实际输入、多结果与未完成成果

Status: ready-for-agent
Completion: complete
Blocked by: 07

**What to build:** 用户用实际选中的图片生成完整有序结果，预览与供应商请求对应；失败时可找回已保存的部分图片并显式另存。

**依据：** [实现规格](../spec.md)；[任务依赖与共同验证](../README.md)。验收覆盖：A12、A15、A18、A22、A23。

## Acceptance criteria

- [x] 图片模型消费公共 Composer、预检与单卡运行，不新增第二套任务／事件接口；能力、参数及最终输入预览来自真实编译。
- [x] B 只引用图片3时，只提交对应图片并将 token 映射为真实输入表达；通用图片子集按接收端顺序，重复同输出只一次，不同来源同文件按两项。
- [x] 数量按实际提交内容校验，模型不支持重复或容量超限则诊断，不静默截断／合并／取第一项；普通文字中的图片编号不自动替换。
- [x] 一次完整成功的所有图片整体形成有序 ResultSet，整体替换当前输出；预览切换不改变下游，旧结果历史保留。
- [x] 沿用现有缺 URL、数量不符、下载／归档失败判定；任务失败但已存文件仍以未完成成果显示，不作为正式输出。
- [x] 未完成或历史图片可预览并显式保存内容卡，建立独立文件引用与来源；运行历史保护其已持久保存的成果。
- [x] 受理后改模型参数、供应商配置及画布内容不影响本任务实际提交／查询；相关依据变化的结果不覆盖当前配置。

## Validation

- MockTransport 捕获实际 prompt、图片数组、参数和调用次数；图片3子集与不同来源同文件均作明确断言。
- 故障注入第3张下载失败，验证前2张归档、failed 状态、原输出保留及另存后的可用性。
- 浏览器完成生成多图、切预览、查看历史、保存内容卡和引用；检查全程使用统一事件流。
- 执行 [共同检查要求](../README.md#共同检查要求) 中适用于本票变更的命令，并记录真实结果。

## Scope and handoff

提供媒体结果归档、历史文件引用及图片输出位置变化的真实案例。视频票可独立于本票实施；12 使用本票产物验收完整清理生命周期。

## Comments

- 2026-10-23：依据已确认术语和 ADR 建立实现票据，尚未开始实现或执行验收。


- 2026-10-23：08 已完成。公共编译在结构化图片引用处按实际数组位置生成 `image N`，普通 `图片3`／`[media:1]` 保持字面；实际 Worker 请求验证第三项子集、重复同输出一次、不同来源同文件两项及数量／重复能力诊断。
- 2026-10-23：完整成功图片整体替换有序 ResultSet，旧历史保留；第3张下载失败实际保留前2张未完成文件，无正式 ResultSet，旧 current 不变。`canvas_history` 文件保护和显式独立图片内容卡保存／不可变来源已接入；媒体另存使用既有文档 CAS 队列。固定路由测试在受理后修改模型、供应商及画布，实际 POST 与两次 GET 仍使用原配置，成果只进旧依据历史。
- 2026-10-23：真实验收：受影响后端及隔离 MySQL **107 passed**（无 skip）；共享生成 **28 passed**，供应商／图片能力 **17 passed**；`UV_CACHE_DIR=/private/tmp/jellyfish-uv-cache-08 PYLINTHOME=/private/tmp/jellyfish-pylint-08 uv run pylint app` 为 **10.00/10**；根目录 `PATH=/Users/extreme/.nvm/versions/node/v22.21.1/bin:$PATH pnpm --dir front run typecheck` 通过。后端完整命令及原始日志见 `/private/tmp/jellyfish-generation-canvas-evidence/08/validation.md`、`backend-final.txt`、`generation-regressions.txt`、`provider-regressions.txt`、`pylint.txt`。
- 2026-10-23：根目录 `PATH=/Users/extreme/.nvm/versions/node/v22.21.1/bin:$PATH PLAYWRIGHT_CHANNEL=chrome node front/tests/run-browser.mjs generation-canvas-images --output /private/tmp/jellyfish-generation-canvas-evidence/08/browser-visible` 为 **PASS7412ms**。真实页面完成三图、切第3项、完整／未完成历史预览、另存未完成内容并作为独立参考，2次显式运行共用1条 SSE；未调用付费模型。截图及 results.json 见上述目录。
- 2026-10-23：交接 `/private/tmp/jellyfish-generation-canvas-evidence/08/handoff.md`：09复用媒体原生预览、固定路由和归档；12须按画布前缀释放 `canvas_history` 使用关系。当前架构事实已同步；OpenAPI/client 从本工作区实际应用临时生成，协调者最终合并后仍按已约定流程核实真实8000并执行 `pnpm --dir front run openapi:update`。集成分支已合入（仅README变更，复用同代码检查结果）。保留原 Status 分诊标签。
