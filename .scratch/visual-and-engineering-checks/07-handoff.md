# 07 组合接入与验收

本票实现完成后的整合由 merger 负责；本记录不代替最终 Standards／Spec 双轴审查。只修改本轮独立记录、CI 与采集测试，不修改产品布局、生成协议或旧01–60／环境检查记录。最终原图及签收结果在下文追加。

## 改动与版本

基于集成 `7eb187db`，工作分支 `codex-checks-07`。CI 显式传入仓库内版本化 manifest，沿原 `typecheck`（lint→unit→typecheck）依赖执行原浏览器运行器，再调用公开证据 CLI；正常失败传播没有豁免。`always()` 归档完整目标目录和 `front/test-results/**`，覆盖原图、配对索引、日志、实际存在的签收 JSON；没有自动批准视觉审阅。这里只核验本地工作流配置，没有远程 CI 执行声明。

共享 `clearCanvasNeighbors` 原本只避开主体，使多个邻卡落到相同坐标；现在使用同一公开键盘移动控件避开主体和已放置邻卡。真实页面先把四卡放在同坐标复现（红），再检查所有卡对间隔（绿）。有限移动上限250与已有 `moveCanvasCard` 一致，适用于十二卡组合；显式左／右／底边场景的位置仍由场景自己指定，未提前移动到安全位置。

补充滚动核验在 F10 初始截图之后执行，初始裁切不会被补图覆盖。来源区域用真实 wheel，窄屏参数用 wheel 与原生 Tab／Shift+Tab，检查数量值与控件中心命中、固定提交／关闭；没有要求某个精确 scrollLeft。模型选择返回时只传同一个 `.generation-material-model` 控件 wrapper，以包含 Ant Select 自己的 selection span；没有放宽通用 helper、接受任意祖先或其他覆盖物。

代码提交：`36943daf`、`f479c85b`、`c24551a7`、`22e47745`、`22437fb0`、`1c7769b9`。中间补充测试的失败与修正保留，不能当成通过旅程。

## 已执行工程检查

使用 Node v24.22.1、Chrome；以下均在独立工作树执行。前端依赖与后端虚拟环境复用现有安装，不在主仓库 install 或安装 hook。

- `node --test front/tests/checkCommands.test.mjs front/tests/visualEvidence.test.mjs front/tests/visualReview.test.mjs`：61 passed，0 failed；`/private/tmp/checks07-cli.log`。原运行器端口占用、跨 cwd、超时、子进程清理和中断生命周期，lint 新增阻断／基线收缩，以及证据与审阅负例均保留。
- `node --test scripts/check-commit-subject.test.mjs scripts/repository-hooks.test.mjs`：14 passed，0 failed；`/private/tmp/checks07-git-cli.log`。临时真实 Git／worktree 验证普通／合并／回滚标题与范围、显式安装、自检、自定义配置保护；没有安装用户实际仓库 hook。
- `pnpm --dir front run test:unit`：exit 0；`/private/tmp/checks07-unit.log`。
- `pnpm --dir front run typecheck`：exit 0；`/private/tmp/checks07-typecheck-current.log`。
- `pnpm --dir front run lint:check`：275 existing，0 new；`/private/tmp/checks07-lint-current.log`。
- `PLAYWRIGHT_CHANNEL=chrome pnpm --dir front run test:browser generation-canvas-common-shell --output /private/tmp/checks07-common-final`：preflight 与 case passed，48.3s；`/private/tmp/checks07-common-final/results.json`。包含四卡邻卡分散及原三视口、边缘操作、保存／重开、真实遮挡与关闭失败诊断。共享 helper 此后未变，复用本结果。
- 红测 `/private/tmp/checks07-neighbor-red`，首次绿测 `/private/tmp/checks07-common-green`；完整范围的 common 最终结果如上。

仅测试基础设施和工作流变化，无应用后端或 API 契约变化，不需要 Pylint 或 OpenAPI 重新生成。

## 中间失败保留

- `/private/tmp/checks07-four-card`：36组原图已采集，但后续名称映射旅程中十二卡的邻卡避让达到旧150步上限，behavior failed；改250后不沿用其通过声明。
- `/private/tmp/checks07-four-card-final`：新来源滚动检查查询了隐藏保留会话，改为可见 region element 后修复。
- `/private/tmp/checks07-four-card-accepted`：新增参数检查不应只要求 wheel 后 scrollLeft>0，后续加入真实键盘与实际数量命中。
- `/private/tmp/checks07-four-card-complete`：数量已可达，但精确复位 scrollLeft===0 超时；改为实际返回首参可达。
- `/private/tmp/checks07-four-card-reviewed`：返回首参已可见，但对 Ant Select 内部 input 的 contains 检查误拒绝自己的 selection span；局部改为完整同一控件 wrapper。

以上目录名不代表验收结果。最终统一版本旅程与签收使用独立目录，不将这些失败合并成通过。

## 最终交付结果

统一固定代码 `1c7769b9654bcab48c8cf9bbdf1427cd39c80e33` 完整旅程220.6s通过，来源未因后续文档提交重写。最终证据 `/private/tmp/checks07-four-card-final-acceptance`；公开evidence CLI exit0、passed／reviewable／not-reviewed；06逐区域review CLI exit0、passed／reviewable／passed，36组192区域。无review exit1；错图像身份及缺region为invalid／exit1；副本更新真实PNG使旧签收不可用，evidence failed／exit1。详情、原图实际查看范围、允许差异与稳定主仓库目标路径见[acceptance](acceptance.md)。主代理仅额外补看F10两张滚动图，不代表其全量复审。

CI依赖／严格传播／登记和80个受保护文件哈希核对通过，日志 `/private/tmp/checks07-config-and-preservation.log`。07只标verified，由merger整合及最终双轴review。没有push或实际仓库hook安装。
