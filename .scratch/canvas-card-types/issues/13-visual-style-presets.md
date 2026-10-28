# 13: 画面风格与可视化预设

**What to build:** 用户通过风格及摄影的可视化示例选择预设、修改设计，再明确采用进入生成；示例素材与生成输入保持分离。

**Blocked by:** [12 摄影设计与图片目标状态](12-photography-and-image-target.md)

**Status:** ready-for-agent

**Completion:** integrated

- [x] 独立画面风格卡保留风格方向、视觉特征、材质、色彩及自定义说明，支持图库、对比、大图预览和已选摘要，默认完整采用。
- [x] 摄影各入口提供与内容相符的展示：景别／构图示意、机位视角对比、运镜短视频、光影与焦点效果预览，沿用同一摄影内容所有者。
- [x] 预设选择形成可编辑的本卡设计，保存重开后能继续修改；浏览示例或切换预览本身不等于应用预设、建立媒体绑定或模型采用。
- [x] 预设生成的结构化字段进入统一输出和编译，不能暗中提交示例中的人物、场景、图片、视频或音频。
- [x] 需要实际使用示例媒体时，必须有合法直接来源和明确采用；内置演示不绕过媒体类型、归属及模型能力限制。
- [x] 风格与摄影依各自完整／局部采用规则进入文本、图片和视频生成；视觉预设不承诺未接入的专用模型控制。
- [x] 专用选择与编辑复用工作台主题、操作容器和媒体预览，窄屏与键盘可用，不引入万能表单引擎或隐藏的第二份设计数据。

规格依据：[总体规格](../spec.md)。共同约束与验证边界见[任务索引](../README.md)。完成证据见下方 Comments。


## Comments

- 2026-10-29：独立分支 `codex-canvas-types-13`，工作树 `/private/tmp/jellyfish-canvas-types-13` 从集成 `e00192ac` 开始；实现提交 `a68a91f7`，显式合入最新集成 `8e94c579` 后为 `7dc31f8d`。保留叙事、空间、表演、对白声音与摄影字段／关系，不回退其他票据。分诊 Status 保持不变。
- HTTP TDD 首先以独立风格保存 422 红灯确认缺口，再实现 `VisualStyleCard`、强类型 `StyleDesignFields` 和整卡 `DesignTextPayload`。五个字段均可保留状态／用途／来源；候选连接不采用，整体采用后进入统一编译。直接固定风格示例遵守合法来源、项目文件和删除保护；示例不进入文本输出，非法摄影局部范围不扩展为风格逐项采用。
- 三模态 HTTP→真实 TaskWorker 回归确认风格字段逐项进入实际供应商请求，未隐式增加媒体；更改完整采用中的材质使原结果依据过期。自有 HTTP／Worker 五条通过。供应商 HTTP、文本供应商和外部存储为受控替身，未验证真实供应商质量。
- 风格图册提供原创几何示意、对比与大图，摄影每个入口提供对应预设。景别／构图、机位、光影、焦点以 SVG 示意；推进／平移以原创三秒 H.264 MP4 示意。示例均明确标为意图说明，不当作项目媒体或模型控制保证。浏览／对比不改本卡、不建立媒体绑定或模型采用；明确应用仅写入对应字段，继续手动修改、保存重开，不产生隐藏预设对象。摄影区域外字段及关系保留。
- 真实 Chrome 红灯确认缺少风格入口后逐步完成页面：图库／对比／大图、摄影五入口、视频实际播放、修改／重开、无自动采用、区域外自定义字段保留、窄屏／键盘、模型明确采用→预检→Worker 图片成果均验证。统一入口合后通过 11.7 秒，证据 `/private/tmp/canvas13-presets-integrated/generation-canvas-visual-presets/`；最终补运镜截图见 `/private/tmp/canvas13-presets-evidence/generation-canvas-visual-presets/`。桌面及390px窄屏截图已人工查看。
- 受影响既有摄影真实页面回归 11.4 秒通过，包含声明范围、图片目标状态、保存重开和独立摄影方案复制，证据 `/private/tmp/canvas13-photo-regression/generation-canvas-photography/`。仅复用共享工作台组件，不修改其代码／样式／示例，沿用12已通过的共享六套验收，不重复运行无关场次套件。
- 合后完整画布后端 `PYTHONPATH=. .venv/bin/pytest tests/test_generation_canvas*.py -q`：239 passed／28 skipped（MySQL等可选环境）；`uv run --no-sync pylint app`：10.00/10，缓存写入警告不影响校验；Node24 `pnpm --dir front run typecheck` 通过。当前 `app.main` 生产 schema 与 committed OpenAPI 精确一致，generated client 已同步并剔除无关纯尾空行差异，证据 `/private/tmp/canvas13-schema-evidence.json`。主区合并后仍由 merger 对已加载最新代码的8000执行标准 `openapi:update`。
- 边界：没有音频生成、未接入专用摄影控制、外部素材自动采用、全局通用表单引擎或跨卡隐藏设计；没有迁移场次工作台或章节，未推送。最终工具箱大类由19统一协议／目录收口。
- 2026-10-29：主区无冲突集成 `7a8c0b4f`，产品代码与已验证分支一致；摄影／风格 HTTP 与真实 Worker 组合 **22 passed**（2.92s）、Node24.22.1 typecheck 通过。复用同一实现全部画布239 passed／28 skipped、Pylint10及两项真实页面证据。已核实主区 `app.__file__`、生产导出、8000实际HTTP与提交OpenAPI精确一致；8000本次恢复后标准 `openapi:update` 成功，418处仅尾空行生成差异经精确核对后剔除。生产导出证据 `/private/tmp/canvas13-integrated-production.json`，HTTP证据 `/private/tmp/canvas13-integrated-http.json`；MySQL缺环境及受控供应商／存储边界保持不变，不将示意素材当作真实供应商质量验收。Completion更新为integrated，分诊Status不变。
