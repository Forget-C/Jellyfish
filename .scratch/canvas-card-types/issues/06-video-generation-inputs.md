# 06: 视频生成的用途与实际采用

**What to build:** 用户把直接文本、图片或视频候选用于受支持的视频输入用途，明确选择后完成预检、拍摄和结果查看。

**Blocked by:** [04 基础媒体导入与明确输出](04-media-content-outputs.md)

**Status:** ready-for-agent

**Completion:** integrated

- [x] 文本依据、首帧、尾帧、关键帧、主体图片参考和主体视频参考按真实能力提供；普通拖线不选择用途或自动采用。
- [x] 首尾帧单值、关键帧顺序、主体分组及各层数量限制按能力校验；当前不支持的主体参考与首尾／关键帧混用返回定位诊断。
- [x] 实际引用与用途统一保存在输入绑定，显示代号随接收端排序变化但来源身份稳定；同一媒体涉及多个主体时不自动任选归组。
- [x] 编译预览和正式请求使用同一份实际有序输入、参数及用途，受理后固定依据；仅候选连接不引发上游执行。
- [x] 视频结果保留真实文件及原音轨，区分当前输出、历史、未完成成果和固定产物；可明确另存或用于受支持的下游主体视频参考。
- [x] 不把视频自动取帧后送入图片参考，不新增音频模型输入、通用视频编辑／续写或动作迁移。
- [x] 该路径的失效绑定、取消、恢复、运行状态及文件保护可观察且与新协议一致；不依赖先完成图片生成票据。

规格依据：[总体规格](../spec.md)。共同约束与验证边界见[任务索引](../README.md)；实际实现与验证证据如下。



## Comments

### 2026-10-28：视频用途采用闭环

- 在 `/private/tmp/jellyfish-canvas-types-06`、`codex-canvas-types-06` 从集成 `8c67ef51` 实施；实现提交 `d5b3827a`，随后以 `[chore] 同步图片生成集成基线` 合并最新 `07e7ab7e`，合并提交 `418b759b`，无冲突。保留05图片独立采用、图片实际预览及共享候选hook，不建立第二份来源或输入权威。
- 视频详情仅按真实能力提供直接文本、帧和主体图片／视频的明确采用，允许取消与排序；主体采用先填分组，不按同一媒体自动选主体。实际用途、顺序及 `subject_name` 位于统一输入绑定，提示词通过binding_id消费；编辑器仅派生展示，后端编译直接消费相同绑定，正文引用帧不会悄悄改成主体。
- 首尾帧单值、主体分组／各层数量、用途／组合及来源类型在预检诊断中定位；视频不能隐式转帧。旧v2跨名称共用同一binding时只按原明确主体指令规范化拆组，保留多组及正文隐式代指，不任选首组；新字段已明确时以canonical绑定名为准，清空亦会阻止运行。
- 复用既有TaskWorker、幂等、取消、恢复、结果集与文件保护；预检和实际请求固定同一用途、顺序和参数，受理后编辑不改变请求。历史新增固定video_media展示；完整视频保留原字节／音轨，可明确另存或用于下游主体视频。未引入图片命名参考、自动取帧、音频输入、视频编辑或动作迁移。

### TDD 与验证

- 沿用用户确认的公开HTTP与真实页面接缝，逐行为红绿：独立bindings帧输入原先为空；主体视频必须明确分组；重复首帧与不支持组合缺少binding定位；视频原先可被错误采用为帧；旧指令参数曾覆盖／阻断canonical分组；正文引用帧曾变成隐式主体；旧v2共享binding曾只留下首组。相关公开HTTP回归均已由失败转为通过；受理后移除绑定仍验证真实Worker按固定帧顺序及原文件字节请求供应商。
- 页面红绿：新增视频采用区原不存在；历史原缺固定视频用途展示（`/private/tmp/canvas06-history-red2`），补齐后通过。环境监听限制、旧桌面详情role定位及测试另存等待条件修正不记作业务红测。
- 合入05后 `PYTHONPATH=. uv run --no-sync pytest -q tests/test_generation_canvas*.py --disable-warnings`：**110 passed / 27 skipped**；`uv run --no-sync pylint app`：**10.00/10，exit 0**（缓存stats写入受限提示不影响结果）。实际使用 `UV_PROJECT_ENVIRONMENT=/Users/extreme/Projects/github.com/jellyfish/backend/.venv`、独立uv缓存与 `PYTHONPATH=.`，已核实app导入来自06工作树，未同步或修改共享环境。
- Node24.22.1 `pnpm --dir front run typecheck` 与差异检查通过。统一浏览器入口 `generation-canvas-video-bindings` 通过，最终证据 `/private/tmp/canvas06-final-video`；覆盖候选不采用／不运行、能力用途、采用、一秒保存、重开、取消、真实Worker完整视频原音轨、历史固定用途、明确另存及下游主体视频必须先命名。1440px／390px截图已检查，响应式切换后等待稳定绘制。
- 合并后 `generation-canvas-images` 真实页面仍通过（11.7s），证据 `/private/tmp/canvas06-merged-images`；只复验共享绑定与renderer影响范围，不重写图片票据。
- 旧结果跨版本兼容：将提交 `07e7ab7e` 后端归档到 `/private/tmp/canvas06-legacy-code`，旧版公开HTTP＋真实Worker生成含普通文本binding的文本／图片成果（2 passed），再由06公开HTTP读取同一SQLite，二者outputs精确一致且basis_current=true。原始结果证据 `/private/tmp/canvas06-legacy-text.json`、`/private/tmp/canvas06-legacy-image.json`，读取脚本 `/private/tmp/canvas06_compat_read.py`；不是同版本重算对比。runtime依据哈希不包含整个binding dump，未改写旧算法。
- 新增可空InputBinding.subject_name已同步OpenAPI与generated client；从06 app导出后执行 `pnpm --dir front run openapi:gen`，纯尾空行漂移已剔除。真实8279服务导出（仅去掉fixture `/test/video-controls`）与提交OpenAPI精确一致，证据最终视频目录内 `openapi-8279.json`。未停止、重载或使用无响应的主区8000，不声称本次标准 `openapi:update` 成功。
- 限制：27项MySQL专用测试未运行；供应商HTTP和外部对象存储为受控替身，不证明真实供应商质量、真实外部存储或MySQL并发。页面保留既有Composer和工作台主题，未改共享主题／四画布布局。

### 2026-10-28：主区集成验收

- 无冲突合并 `codex-canvas-types-06` HEAD `39800559`，集成提交 `63a028ac`；源分支已含主区 `07e7ab7e`，合并后代码与已验收实现一致。Completion 更新为 integrated，分诊 Status 保持不变。
- 主区 `PYTHONPATH=. uv run --no-sync` 核实 app 导入来自当前工作区；视频及公开 API 回归 **61 passed / 2 skipped**，Node24.22.1 typecheck 与差异检查通过。复用同一代码的全部画布 **110 passed / 27 skipped**、Pylint **10.00/10**、图片／视频真实页面及旧版文本／图片实际成果跨版本依据兼容证据，未重复扩大验证。
- 主区生产 app 在隔离 `8286` 导出 OpenAPI，与已提交 schema 精确一致且不包含测试控制路由，证据 `/private/tmp/canvas06-integrated/openapi-8286.json`。重新生成 client 仅365处纯尾空行漂移，核对后全部剔除；8000 在隔离环境内探测无响应，提升权限复核健康检查已响应，但未核实其代码归属；未停止、重载或从其拉取 schema，不声称本次标准 `openapi:update` 成功。
- 继续保留 MySQL 专用测试未运行、供应商与外部存储使用受控替身的限制；08 独立工作树未触碰，后续接入需保留可空 `InputBinding.subject_name` 及新绑定权威语义。

### 集成后标准接口生成复核

主区确认 8000 服务已恢复，进程工作目录为当前 backend，公开 schema 与集成版本精确一致；标准 openapi:update 成功。仅尾空行生成差异已逐文件确认并剔除。此前隔离导出时的 8000 限制已解除，MySQL 与真实供应商验证限制保留。
