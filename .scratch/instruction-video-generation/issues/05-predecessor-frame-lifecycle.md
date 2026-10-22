# 05: 实际落幅承接与依赖状态一致

**What to build:** 用户将已采用片段所选区间的实际落幅作为当前单元首帧，在一次操作中建立或替换承接来源；移除或换图后，前段依赖保持真实、可保存且有明确的待绑定状态。

**Blocked by:** 03 — 首尾帧独立配置并进入视频生成

**Status:** ready-for-agent

**Spec:** [AI 指令起草与参考媒体视频生成链路](../spec.md)，实施决策 6、7、10；验收 A10、A11、A12、A13，以及有关的 A06、A09、A16、A20。

## Acceptance criteria

- [x] 继续仅从已保存、已采用真实片段的所选媒体区间提取最后可解码画面，保留源 Take、片段、区间、取帧时间和文件依据。
- [x] 用户在单元画布明确应用承接时，同步建立首帧、素材来源及依赖；首帧已占用时不得自动退为主体参考。
- [x] 已有首帧时展示原图和拟用图片，明确替换才更新；取消保留原图片与依赖关系，整次应用可以按已有编辑机制撤销。
- [x] 本期场次工作台的新承接操作每单元只选一个前段；从 A 改为 B 时明确替换，并同时更新首帧和依赖，不留下两个生效承接。
- [x] 约束限于场次工作台及对应服务边界；读取及无关编辑不自动删减既有多前段，重新配置时要求明确选择保留的来源。
- [x] 历史来源同样展示原身份和已有占用，不绕过冲突追加承接；不扩大修改共用依赖契约或旧生产入口，不重写固定历史。
- [x] 卡片标明承接片段，可定位原片段及取帧依据；源片段、采用区间或相关依据变化按现有规则失效或待复核，不自动换图。
- [x] 移除承接图片时，清除依赖中的实际落幅及参考绑定，保留声明并回到待绑定；允许保存合法未齐备配置，生成继续受原硬门槛阻塞。
- [x] 将承接首帧换成无关图片前说明依赖影响；应用后新图只是普通首帧，原依赖清除落幅与参考绑定并待绑定，不继续显示承接有效。
- [x] 明确“移除前段依赖”才删除目标声明；普通解绑不删除原媒体、取帧记录或其他独立配置。
- [x] 非法或伪造来源、文件不符、失效落幅和版本冲突不得形成部分保存；只影响相关单元，不错误阻断其他独立单元。
- [x] 完成浏览器和场次 HTTP 状态转换、事务及异常输入验证，以及受影响类型检查、后端检查、契约与文档同步。

## Validation

- 复用末帧提取、前段依赖及保存事务用例，验证选取、替换、取消、撤销、移除图片、换普通首帧、重新绑定和明确取消依赖的可观察状态。
- 用已有多前段及历史来源夹具核对无关保存不会清理数据；使用伪造或不匹配证据验证请求失败后原内容仍完整。
- 复用 03 的首帧传递路径，确认承接所得图片确实以首帧角色进入固定任务输入；不新增中间关键帧、任意位置取帧或新首帧提取能力。


## Implementation evidence

- 场次保存服务比较当前与提交的承接来源和真实绑定：新增或重配只留一个，场次与历史计划合计；历史多前段及失效原绑定可原样读取/无关保存，新选失效证据拒绝事务。共用依赖 schema 和旧生产保存路径未改。
- 单元承接通过共享工作台弹窗比较原首帧与拟用落幅，明确应用后一次替换首帧、来源和唯一声明；普通参考移除/换图同次清除 frame/reference，保留 pending。首帧卡展示承接身份并定位原采用/取帧详情。
- TDD：HTTP 新增第二前段原行为返回 200（应 422）；浏览器原行为没有应用确认；真实旧区间落幅新绑定原行为返回 200（应 409）。上述 red 均在对应修改前确认，green 保留为持续回归。
- `UV_CACHE_DIR=/tmp/jellyfish-uv-cache uv run --no-sync pytest tests/directing/test_scene_dependencies.py tests/directing/test_scene_end_frames.py tests/directing/test_scene_video.py tests/directing/test_canvas_graph.py tests/directing/test_unit_canvas_preview.py -q`：56 passed；含原 03 的完整媒体到 provider 字节/角色测试。新承接另经真实 HTTP 末帧提取、固定首帧任务、伪造/文件不符/过期/CAS 事务验证。
- `PLAYWRIGHT_CHANNEL=chrome node front/tests/sceneFrameDependencies.browser.mjs`：PASS。端口 4265/8265，统一 browser-runtime；桌面与 390px，取消、整次撤销、移除图、换普通图、重新绑定、A→B、历史来源占用和未相关单元门槛均覆盖。
- `pnpm --dir front run typecheck`、`cd backend && UV_CACHE_DIR=/tmp/jellyfish-uv-cache uv run --no-sync pylint app`：通过，Pylint 10.00/10。没有 schema 变化；沿用已有 generated client。
- 最终截图/日志保留于主仓库忽略目录 `front/test-results/instruction-video-05/`（`predecessor-desktop.png`、`predecessor-mobile.png`、`run.log`）；未复制数据库或凭据。
