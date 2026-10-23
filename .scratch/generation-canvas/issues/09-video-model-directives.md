# 09: 视频模型的结构化用途指令与单视频生成

Status: ready-for-agent
Completion: complete
Blocked by: 07

**What to build:** 用户在共用输入框用固定指令选择首尾帧、关键帧和主体参考，核对真正的媒体用途后生成一段视频。

**依据：** [实现规格](../spec.md)；[任务依赖与共同验证](../README.md)。验收覆盖：A13、A14、A15、A18、A23。

## Acceptance criteria

- [x] 实现四条已确认系统指令的选择与手写解析、独立配置块、同行正文边界；不调用 LLM 解析用途。
- [x] 首／尾帧各一次，关键帧保留指令顺序；缺参数、重复、类型不符、能力不支持及不支持组合可保存并定位阻止执行。
- [x] 指令媒体直接计为实际输入，无须正文重复引用；展开的上游文本不得执行指令或产生新依赖。
- [x] 直接素材引用使用隐式代指；唯一显式主体可替换对应 token，多组共用素材保留素材代指；保留周围正文，同名不额外做人物冲突校验。
- [x] 最终预览与标准视频 DTO、实际 Adapter 首尾帧／关键帧／主体字段一致；实际提交的媒体编号映射不依赖接收端显示序号。
- [x] 参数只开放模型、画幅、时长和高级随机种子，依据真实能力；首版无音频参考、时间码、通用视频编辑／续写及其他未纳入参数。
- [x] 每次仅一段视频、统一 ResultSet 和事件流，文件带音轨则完整保留；失败／取消保留已存成果，另存内容卡固定来源。
- [x] 视频提交及轮询所用有效配置／路由固定，运行中修改不重定向既有任务；不改现有 Task 机制。

## Validation

- 用项目上传图片／视频建立引用即可独立验收，不依赖图片模型已实现。
- MockTransport 检查供应商实际请求字段、用途顺序、主体名及运行中配置修改后的查询路由。
- 浏览器验证四类指令、错误定位、同行正文、三种主体情况、视频预览／音轨与历史另存。
- 执行 [共同检查要求](../README.md#共同检查要求) 中适用于本票变更的命令，并记录真实结果。

## Scope and handoff

复用 07 的运行协议并扩充视频能力，不创建专属事件通道。13 负责把本票与图片模型、多节点执行组合回归。

## Comments

- 2026-10-23：依据已确认术语和 ADR 建立实现票据，尚未开始实现或执行验收。


- 2026-10-23：09 完成。四条固定指令的选择／手写形成相同片段和配置块；真实浏览器发现并修复“首个关键帧后的空白过早完成指令，第二个引用落入正文”。现在在 Enter／Tab／失焦时按固定语法完成本地指令，保留同行正文及连续引用顺序。缺参数／引用、重复首帧、错类型及不支持组合可保存并稳定定位阻止运行。
- 2026-10-23：公开编译及实际 Worker 的 Vidu／火山请求验证首尾帧、关键帧顺序、隐式主体、唯一命名、同名合并、多组共用素材、普通 `[media:1]` 及展开文本不再解析。能力按真实 Adapter 收紧：OpenAI 只传递单首帧，命名主体仅 Vidu，当前不声称支持主体与帧组合。标准视频 DTO 仅模型、画幅、时长、种子；每次一段，完整文件字节不转码。
- 2026-10-23：`cd backend && JELLYFISH_TEST_MYSQL_URL='mysql+aiomysql://root@127.0.0.1:32768/jellyfish_check_gc09_01a16891' uv run --no-sync pytest tests/test_generation_canvas_video.py tests/test_generation_canvas_images.py tests/test_generation_canvas_runs.py tests/test_generation_canvas_api.py tests/test_generation_canvas_compiler.py tests/test_generation_canvas_parameters.py tests/services/test_task_worker.py tests/services/test_task_files.py tests/services/test_task_mysql.py tests/architecture -q` 为 **100 passed**；合入08最终新增测试后，`uv run --no-sync pytest tests/test_generation_canvas_video.py tests/test_generation_canvas_images.py -q` 同样带上述隔离库环境，为 **27 passed**。实际 MySQL Worker 提交后修改供应商名／认证／路由及模型名，两次真实轮询仍走固定路由；后续用受控外部时钟消除轮询到期时间的测试抖动。日志见 `/private/tmp/jellyfish-generation-canvas-evidence/09/backend/`。
- 2026-10-23：`cd backend && uv run --no-sync pylint app` 为 **10.00/10**；根目录 `PATH=/Users/extreme/.nvm/versions/node/v22.21.1/bin:$PATH pnpm --dir front run typecheck` 通过。运行时和当前输出仍在文档之外，复用06/07事件／控制器及08媒体归档／历史／另存来源保护；未修改通用 Task 锁顺序或状态机制。
- 2026-10-23：根目录 `PATH=/Users/extreme/.nvm/versions/node/v22.21.1/bin:$PATH PLAYWRIGHT_CHANNEL=chrome node front/tests/run-browser.mjs generation-canvas-video --output /private/tmp/jellyfish-generation-canvas-evidence/09/frontend/final-video-layout` 为 **PASS9778ms**，包含四条选择／手写、关键帧次序、缺参数／引用、错类型／重复／组合定位、三种主体规则、一次真实提交、原生视频捕获到1条音轨及历史另存。相同环境 `node front/tests/run-browser.mjs generation-canvas-composer --output /private/tmp/jellyfish-generation-canvas-evidence/09/frontend/composer-regression` 为 **PASS8099ms**。真实视频由 ffmpeg 生成蓝色视频及 AAC 音轨，项目上传图片独立建引用，不依赖图片生成；没有付费调用。
- 2026-10-23：当前架构、OpenAPI/client 已随共同媒体契约同步；最终核实真实8000的 `openapi:update` 由协调者执行。完整验证与13交接见 `/private/tmp/jellyfish-generation-canvas-evidence/09/validation.md`、`handoff.md`。保留原 Status 分诊标签。
