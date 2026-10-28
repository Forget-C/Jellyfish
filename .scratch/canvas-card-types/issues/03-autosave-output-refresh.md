# 03: 约 1 秒自动保存与下游刷新

**What to build:** 用户持续编辑时约每秒合并保存，保存成功后看到相关下游输出更新；网络延迟、保存失败或冲突不会覆盖新编辑或伪造已生效内容。

**Blocked by:** [01 新协议下的文本生成闭环](01-text-protocol-flow.md)

**Status:** ready-for-agent

**Completion:** implemented (awaiting integration)

- [x] 本卡编辑立即反馈，有修改时约每 1 秒合并提交最新内容；持续输入期间也保存，无修改不发送请求，不改成停止输入后的去抖。
- [x] 同一画布保存请求串行；在途期间只保留最新待保存内容，不为每次输入排队，回执推进保存基线而不覆盖后续编辑。
- [x] 保存成功后由后端统一计算相关明确输出与诊断；前端按对应已保存修订刷新候选及已采用内容展示，旧输出响应不能覆盖较新状态。
- [x] 手动保存和点击生成立即处理待保存修改，不等下个周期；已有请求仍串行协调，保存或预检失败时不继续提交生成。
- [x] 失败或冲突保留本地编辑并提示，同一无效内容不每秒重复报错；结果未明沿用原请求身份核实，修订冲突不静默覆盖。
- [x] 已保存输出与本地编辑状态可区分，不新增草稿实体、草稿发布流程或保存前跨卡输出预览接口。
- [x] 保存与输出刷新不自动采用新增候选、不触发模型、不改历史；模型结果发布仍走既有结果生命周期。
- [x] 约 1 秒只定义保存合并周期，实际下游延迟还包含请求和计算；布局整理不因此制造生成依据变化。

规格依据：[总体规格](../spec.md)。共同约束与验证边界见[任务索引](../README.md)；实际实现与验证证据如下。



## Comments

### 2026-10-28：约一秒保存与已保存输出刷新

- 基于集成 43766520，在 codex-canvas-types-03 独立工作树实施，仅本票范围。沿用既有文档、保存回执、串行队列、恢复保护、所有权和内容撤销／重做，周期由五秒改为一秒；持续输入仍提交，在途仅保留最新文档，回执只推进基线。
- 相同失败正文暂停周期重试；修改内容或手动保存后继续。未知结果继续保留原请求身份，冲突仍要求明确处理，不静默改写修订。
- 模型详情从既有 outputs 与 compile HTTP 接口读取已保存来源、正式输出及诊断，两者都核对保存基线 revision 和查询范围；来源的采用标识来自已保存卡片，未保存正文仍立即编辑。正式输出的依据有效性在文档保存后重新读取，不等待下一次模型事件。
- 未增加后端／公开 HTTP 契约、存储实体或另一套输出编译逻辑；没有生成或采用的自动动作。新增候选的其他类型语义仍由各票交付。

### TDD 与验证

沿用已确认 HTTP＋真实页面接缝。Node 24、本机 Chrome；真实隔离 SQLite HTTP 后端与 TaskWorker，只有外部文本供应商使用受控替身，没有付费模型调用。

- 红绿：/private/tmp/canvas03-red3 的持续输入 1.75 秒后 revision 仍为零；一秒周期实现后 /private/tmp/canvas03-green1 通过。
- 红绿：/private/tmp/canvas03-red5 的相同无效名称被自动提交三次；暂停失败正文后 /private/tmp/canvas03-green2 通过。
- 红绿：/private/tmp/canvas03-red6 无已保存来源正文区；接入输出展示后 /private/tmp/canvas03-green3 通过。
- 红绿：/private/tmp/canvas03-red7 无已保存 OUTPUT_MISSING 诊断；复用 compile 后 /private/tmp/canvas03-green4 通过。
- `PLAYWRIGHT_CHANNEL=chrome pnpm --dir front run test:browser generation-canvas-autosave --output /private/tmp/canvas03-final` 通过（18.2s）；覆盖持续输入、空闲不提交、失败暂停、慢网络串行与仅保存最新内容、旧回执保留本地输入、未知回执重放原身份、已保存来源及采用、清空输出诊断、旧输出响应、正式输出依据刷新、历史不变及预检前立即保存。桌面1440与窄屏390截图已检查。
- 既有 `generation-canvas-save` 通过（9.7s），证据 /private/tmp/canvas03-save，覆盖恢复、外部修订冲突、所有权、存储失败与离开前保存。
- `test:browser workbench` 六个用例全部通过，证据 /private/tmp/canvas03-workbench：workbench-ui、workbench-style、design-scope、unit-design、instruction-preparation、instruction-design。
- `pnpm --dir front run typecheck` 与 `git diff --check` 通过。未改变 Python 或对外契约，无需本票 Pylint／OpenAPI 重生成。浏览器预检最初遇到沙箱监听限制及未安装捆绑 Chromium；获得执行权限后改用已安装 Chrome，最终完整通过，未将环境失败计作业务红测。
- 限制：SQLite 真实页面不证明 MySQL 竞争或真实供应商质量；一秒是保存合并周期，不保证下游总延迟一秒。新增展示复用现有主题与正文控件；既有 Composer 浅色表面未在本票改动。

### 集成基线复验

- 以 `[chore] 同步画布集成基线` 合并集成 436691a2（含04），合并提交 f5427046，无冲突。03 真实页面 autosave 再次通过（19.5s），证据 /private/tmp/canvas03-merged；合并后 typecheck、git diff --check 通过。04 带入的 Python 与输出契约变更复用04票据验证，本票未额外修改。
