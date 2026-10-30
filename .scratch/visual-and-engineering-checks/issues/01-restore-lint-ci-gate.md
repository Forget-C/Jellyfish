# 01: 恢复 lint 门禁与既有 CI 检查链

**What to build:** 开发者运行既有检查时，两处已定位的hooks依赖问题得到正确修复，lint基线门禁恢复通过；诊断定位和直接候选读取保持正确，CI仍按原严格依赖继续检查。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Completion:** integrated

- [x] 处理诊断片段定位与候选读取的两处effect依赖，依赖当前实际读取值或稳定派生身份；新定位目标生效，旧请求不能覆盖新范围，不引入无限查询或重复抢焦点。
- [x] 通过真实页面／公开HTTP验证同卡不同片段的最新定位、候选修订刷新及旧响应拒绝；复用已确认受控供应商与存储，不新增业务能力。
- [x] 既有lint基线检查通过；保留原始lint输出，不关闭规则、不增加豁免或扩大存量基线。不把原始lint仍有已知存量诊断说成失败已清零。
- [x] 必要时只显式收缩已解决的基线条目并记录原因；复用公开CLI回归证明新增诊断非零失败，收缩操作也不能接纳新问题。
- [x] 现有前端CI的lint、纯逻辑、typecheck和浏览器依赖保持，不能通过绕过上游门禁放行；核对工作流配置与本地实际命令，未执行远程CI时如实说明。
- [x] 完成受影响页面和命令回归、前端typecheck及必要单元检查，保留实际命令结果和未完成项；不清理无关存量代码。

**规格覆盖：** User Stories 17、18、19、20、21、22、23、24。

## 依据与边界

依据[独立规格](../spec.md)与[本轮索引](../README.md)。本轮已确认公开CLI、临时Git仓库／worktree和真实页面验收接缝；供应商与外部存储沿用受控替身，业务HTTP复用既有入口。测试观察退出码、结果、实际Git行为、真实页面及原图，不依赖私有函数或复制实现公式。

按实际改动运行必要检查，只有应用后端或公开契约变化才增加对应同步与验证。保留既有生成画布业务、旧01–60及前期环境检查完成记录；不新建平行运行器或为少量相似代码机械抽象。

## Comments

- 2026-10-30：用户确认七张纵向票据及阻塞关系，授权创建文件和更新依赖图；本轮暂不开始实现。Status仅表示分诊状态，所有验收待实际执行，不预记Completion。

- 2026-10-30（票01实现，待 integration 整合）：基于 `codex-visual-engineering-checks` 的 `cbf82d42` 创建独立 worktree。先以公开 `pnpm --dir front run lint:check` 复现两条新增 `react-hooks/exhaustive-deps` 失败，再补齐诊断目标的稳定 card/segment/serial 依赖与候选的稳定 entity 依赖。保留 scope、active、latest 和响应 revision 校验；未修改规则、基线、工作流或其他存量代码。
- 页面回归：扩展已有 `generation-canvas-input-stability`，真实 HTTP 返回的新修订先展示、再释放先前被延迟的旧响应，确认展示修订不回退、输入几何稳定且不自动采用；连续定位同卡的两个指令片段，确认当前片段取得焦点，随后调整视口不会重复抢焦点。`PLAYWRIGHT_CHANNEL=chrome pnpm --dir front run test:browser generation-canvas-input-stability` 通过，证据 `front/test-results/browser-DZS0Yd/`。既有 `generation-canvas-runtime` 通过，证据 `front/test-results/browser-vUFf3l/`；覆盖受控 Worker、发布刷新、真实预检与原诊断旅程。
- 工程验证（Node 24.22.1）：`pnpm --dir front run lint:check` 通过（275 项已知问题，0 项新增，无需收缩基线）；`pnpm --dir front run typecheck`、`pnpm --dir front run test:unit`、`git diff --check` 通过。单元集合包含既有公开 lint CLI 案例：新增诊断非零失败、prune 不接纳新增、显式收缩后旧诊断不能回归。原始 `pnpm --dir front run lint` 退出 1，仍报告 173 errors / 102 warnings，完整输出保留于 `/private/tmp/jellyfish-checks-01-raw-lint.log`，不宣称存量清零。
- CI 配置核查：`.github/workflows/frontend-checks.yml` 的 typecheck job 仍依次执行 lint:check、test:unit、typecheck；workbench-browser 保留 `needs: typecheck`，原有严格失败传播与 artifact 步骤未改。未推送、未执行远程 CI。默认 Chromium 缺失导致首次预检失败，按既有入口设置 `PLAYWRIGHT_CHANNEL=chrome` 后预检及页面用例通过；这是环境缺失而非产品断言失败。测试开发中修正过隐藏区域 role 定位和重复 DOM 计数断言，最终以实际可见焦点与显示结果验收。

- 2026-10-30（integration 整合）：票01实现分支提交 `13ff6fff` 已通过合并提交 `9be30ce9` 整合到 `codex-visual-engineering-checks`；无冲突，复用以上已通过检查记录，未修改相关实现或重跑无变化检查。`Status` 保持分诊状态 `ready-for-agent`，以 `Completion: integrated` 标记交付状态。
