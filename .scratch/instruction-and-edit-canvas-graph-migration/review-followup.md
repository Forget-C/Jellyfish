# 2026-10-22 复审两项 P2 修复

起点：`909d719829c2111fc54cf1a5e9f0d520ae540bf9`。仅修复本轮 Spec 发现，不修改父规格。

## 接缝历史读取

原查询对当前接缝展开全部历史决策及完整时间线。现在新增 `c5f9a3b7d846`（接 `b4e8f2a6c735`），升级时分批回填接缝 `basis_key`，旧完整证据保留。新记录写入同一规范依据键；普通版本读／保存／列表只由数据库预选每对真实接缝最新及最近适用记录，再读取至多两条决策，不读取历史时间线。只展示原规则选中的当前适用结论或最新待复核结论，复制仅消费原记录白名单。

迁移红灯：缺失新迁移；HTTP 红灯：36条接缝历史的版本读／保存／列表仍读取固定时间线。绿色定向17项覆盖旧数据回填与降级、平移等价、不同构图、无匹配、恢复最早适用结论、显式完整历史及另存后不追随来源新增记录。SQL预算观察沿用既有数据库边界，不 mock 内部投影器。

运行新应用前，在 `backend` 执行 `uv run alembic upgrade head`。没有修改现有开发数据库；对外响应契约未变，无需重新生成 OpenAPI。

## 剪辑浏览历史

原总览／素材图／工作区切换只修改本地状态。现在使用后端不透明 view ID、版本限定路由、`useGraphBrowse` 与原布局缓存；顶部明确画布切换也记录画布身份。条目只保存对象、记录和焦点，不复制内容或表单。POP 到图时不把旧选择写回隐藏编辑区；POP 到工作区恢复对应定位，保留未应用输入。图缺失仍明确报错且原工作区可进入。

真实浏览器红灯：进入素材图后 Back 无法恢复整场图；补充红灯发现 POP 恢复图选择会清空隐藏表单，已修。绿色验证浏览器／画布 Back/Forward、原缩放恢复、未应用出点1600及同DOM、跨导演返回、无隐式保存或播放、图刷新失败与重试、缺图编辑入口，以及390px键盘路径。证据 `jellyfish-scene-version-bqLLQK`，桌面／390截图已实际查看。

## 验证状态

- 定向后端17项通过；前端 typecheck、完整 test:unit、lint:check通过（292存量／0新增，仅 prune 两条已修复豁免）。
- Pylint exit0，10.00；Hugo构建157页通过。
- 完整后端：使用测试公共 URL `S3_PUBLIC_BASE_URL=https://files.example.test` 执行 `UV_CACHE_DIR=/tmp/jellyfish-uv-cache uv run --no-sync pytest -q`，796 passed、19 skipped（184.48s）。首次缺该配置时三项原文件 URL 测试失败；补齐测试配置后全量通过，未连接真实对象存储。
- 最终独立审查到 `a237ff9`：Standards 0 项；Spec 0 项。两轴分别检查，未将测试结果当作独立阅读证据。

## 最终导航边界与回归修正

正式回归发现首次关系定位在 StrictMode 下被重复初始化覆盖；改为首次挂载即固定明确导航意图。Spec 复审发现原始无 `canvas` 入口后退未恢复默认导演／单元画布；父级 POP 复用默认解释，子级不改写其他画布历史位置。新增真实浏览器红灯后转绿，保留原表单 DOM、未应用输入和原业务定位。

刷新现在保留当前画布，测试助手先从真实顶部按钮进入导演总览。另修正三个不透明地址夹具，使列表和详情刷新返回一致图地址；原夹具仅匹配列表，会制造不存在于后端的视图身份变化。HTTP 响应已确认包含正确接缝摘要，原业务、焦点、输入和播放断言全部保留。

最终浏览器证据分批保留，覆盖正式 all 清单的全部 17 项用例：

- workbench-ui、workbench-style、design-scope：`/tmp/jellyfish-review-followup-browser-20261022-1`。
- graph-navigation、director-layout、canvas-graph、graph-summary、legacy-graph、periodic-save、instruction-evidence：`/tmp/jellyfish-review-followup-graph-final-2`。
- edit-seams-graph：`/tmp/jellyfish-review-seam-final-2`。
- edit-graph、edit-cut-evidence、timeline、take-library-graph、take-library、legacy-take-library：`/tmp/jellyfish-review-remaining-final`。

失败尝试日志保留于各自目录；上述仅列最终通过记录。新一轮 390px 截图 `jellyfish-scene-version-KPSLLH/edit-graph-narrow.png` 已实际查看，导航与工作区入口无重叠。最终 typecheck、完整前端 unit、lint（292 存量／0 新增）、Pylint 和 Hugo 通过记录复用同一代码与环境；新增测试夹具修改后 lint 再次通过。

原仓库分支及 HEAD 未改动；原仓库另有用户新增未跟踪目录，不处理。此次 worktree 未执行真实数据库升级、push 或 PR。
