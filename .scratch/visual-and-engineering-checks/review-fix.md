# 最终审查修复：默认浏览器

2026-10-30。基于 integration `e88040b712929ad65a51ac9aaec97d9db724555b`，独立 worktree `/private/tmp/jellyfish-checks-review-fix`／分支 `codex-checks-review-fix`。Standards 0项，Spec 1项P2：证据验证默认强制本机 Chrome，与现有四卡入口、preflight及CI安装的 Playwright Chromium 不一致。

`front/scripts/visual-evidence.mjs` 只移除隐式 `chrome` 默认值：未设置／空 channel 使用 Playwright 自带 Chromium；`PLAYWRIGHT_CHANNEL=chrome` 仍显式选择本机 Chrome。没有改变采集、图像身份、签收或产品代码。

## TDD 与验证

沿用已确认的公开 CLI／临时输入目录 seam；没有调用私有函数、mock或静态代码匹配。新增回归使用合法36组受控 fixture，设置全新空 `PLAYWRIGHT_BROWSERS_PATH`，删除 `PLAYWRIGHT_CHANNEL`，要求退出1、evidence failed，错误定位到该浏览器目录、visual仍未审阅。旧实现会绕过该目录使用已安装Chrome，成功退出0／reviewable，所以测试能检出真实行为差异。

全部使用 Node v24.22.1。命令均从独立 worktree 运行，依赖链接到已有安装；真实浏览器检查在允许启动浏览器的执行环境运行。首次沙箱内红测因Chrome启动限制失败，仅作为环境失败，不计为有效RED；随后相同旧代码在可启动环境取得下述真实RED。

```bash
export PATH=/Users/extreme/.nvm/versions/node/v24.22.1/bin:$PATH
PLAYWRIGHT_CHANNEL=chrome node --test --test-name-pattern='bundled browser runtime' front/tests/visualEvidence.test.mjs
PLAYWRIGHT_CHANNEL=chrome node --test front/tests/checkCommands.test.mjs front/tests/visualEvidence.test.mjs front/tests/visualReview.test.mjs
pnpm --dir front run typecheck
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/checks-review-fix-browsers node front/node_modules/playwright/cli.js install chromium
env -u PLAYWRIGHT_CHANNEL PLAYWRIGHT_BROWSERS_PATH=/private/tmp/checks-review-fix-browsers node --test front/tests/visualEvidence.test.mjs front/tests/visualReview.test.mjs
```

- 有效RED：1 failed，实际status0／reviewable，预期status1；`/private/tmp/checks-review-fix-red.log`。单行修复后GREEN：1 passed；`/private/tmp/checks-review-fix-green.log`。
- 显式Chrome完整公开运行器／evidence／review回归：62 passed，0 failed；`/private/tmp/checks-review-fix-cli.log`。受控fixture不代表人工视觉签收。
- typecheck exit0；`/private/tmp/checks-review-fix-typecheck.log`。
- Chromium仅安装到独立临时缓存（Playwright v1248，Chromium／headless shell156.0.8078.4）；`/private/tmp/checks-review-fix-browser-install.log`。不修改全局依赖或用户Chrome。
- 未设置channel的 bundled Chromium 完整evidence／review回归：56 passed，0 failed；`/private/tmp/checks-review-fix-chromium.log`。同样包括36组成功解码及全部身份／签收负例。
- `git diff --check` exit0；完成前 `git merge codex-visual-engineering-checks` 返回Already up to date（集成仍为e88040b7）。

## 原验收的机械复核与边界

```bash
M=/Users/extreme/Projects/github.com/jellyfish/front/tests/visual-baselines/c-794ee4a0-v1/manifest.json
E=/private/tmp/checks07-four-card-final-acceptance/generation-canvas-four-card-acceptance
PLAYWRIGHT_CHANNEL=chrome node front/scripts/visual-review.mjs \
  --manifest "$M" --matrix "$E/matrix.json" --run "$E/visual-run.json" \
  --review "$E/review.json" --output /private/tmp/checks-review-fix-final-signoff.json
```

exit0，behavior passed／evidence reviewable／visual passed，36组；日志 `/private/tmp/checks-review-fix-final-signoff.log`。这只重新核验已有签收与原图／capture／contract身份，没有重新阅图或采集，没有覆盖原review-result。采集来源仍为 `1c7769b9654bcab48c8cf9bbdf1427cd39c80e33`，适用范围仍按[本轮acceptance](acceptance.md)。本修复只影响验证器浏览器选择，复用此前同代码／同图片的旅程与人工原图审阅。

没有远程CI执行声明；没有重跑无关应用全套或浏览器36组采集；没有后端／API改动；没有push或安装主仓库hook。旧01–60／80受保护历史与其他票据记录未修改。最终由merger整合并交原reviewers复核。
