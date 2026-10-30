# 02: 统一本地与 CI 提交标题校验

**What to build:** 提交者通过本地Git hook或既有CI入口得到同一标题校验结果；普通、合并、解决冲突后及回滚提交都执行现有规则，错误在首次提交或提交范围检查时明确阻断。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Completion:** integrated

- [x] 以现有提交规范为唯一规则依据，hook和CI调用同一可验证校验实现；不继续维护两份正则、两套类型枚举或不同例外。
- [x] 保留Git消息文件输入及既有CI提交范围入口；合法类型、分隔空格、非空摘要和合法中文内容正常通过，空标题、非法类型及缺摘要明确失败。
- [x] 默认Merge／Revert标题不再豁免，合并中存在MERGE_HEAD或解决冲突后也不跳过首行检查；不依靠实施者手工检查标题替代确定性门禁。
- [x] 范围内每个待检提交均被检查，包括多父提交；错误引用或范围非零失败，合法空范围明确报告没有待检提交，不冒充已经检查过提交。
- [x] 在临时真实Git仓库验证合法／非法普通提交、合并、冲突解决后提交及回滚；同一消息／范围通过本地和CI使用的公开入口得到一致结论。
- [x] 既有CI提交检查实际适配到同一规则，失败保留提交身份、标题与规则原因；不等待07才接入本票必要的CI适配，不另建检查平台。
- [x] 不修改真实项目历史、Git身份或签名策略。临时夹具内的hook配置只服务本票校验；面向开发者的持久安装与自检由03交付。

**规格覆盖：** User Stories 25、26、27、28、29、30、31。

## 依据与边界

依据[独立规格](../spec.md)与[本轮索引](../README.md)。本轮已确认公开CLI、临时Git仓库／worktree和真实页面验收接缝；供应商与外部存储沿用受控替身，业务HTTP复用既有入口。测试观察退出码、结果、实际Git行为、真实页面及原图，不依赖私有函数或复制实现公式。

按实际改动运行必要检查，只有应用后端或公开契约变化才增加对应同步与验证。保留既有生成画布业务、旧01–60及前期环境检查完成记录；不新建平行运行器或为少量相似代码机械抽象。

## Comments

- 2026-10-30：用户确认七张纵向票据及阻塞关系，授权创建文件和更新依赖图；本轮暂不开始实现。Status仅表示分诊状态，所有验收待实际执行，不预记Completion。

- 2026-10-30（票02实现，待整合）：新增公开 CLI `scripts/check-commit-subject.mjs`（`--message-file` / `--range BASE..HEAD`），由 `commit-msg`、`prepare-commit-msg` 和既有 `commit-messages.yml` 共用。无默认 Merge/Revert 或 MERGE_HEAD 例外；范围先解析两个 commit 引用，再遍历含多父提交的全部待检提交。错误包含身份、实际首行和具体规则原因；合法空范围明确报告没有待检提交。
- TDD：先记录消息文件入口缺失失败，再实现合法标题；范围入口先失败后实现；真实 Git 默认合并先证明旧 hook 未阻断，再适配共享 hook。真实 Git 自动 revert 未调用 commit-msg，补 prepare-commit-msg 后非零阻断；该时点不存在 REVERT_HEAD，按 Git 提供的 message source 转交共享校验，不复制标题规则。正常回滚支持 `git revert --no-commit` 后合法 `[revert]` 提交，默认回滚失败后也可用合法标题提交已暂存变更。
- 验证：Node 24.22.1 `node --test scripts/check-commit-subject.test.mjs` 5/5 通过，覆盖全部允许类型、中文、非法类型/分隔/空摘要/空首行/默认标题/缺失消息文件、无效引用/范围/合法空范围、多条失败身份、真实普通提交/默认合并/绕过 hook 的多父提交/默认回滚/合法回滚/冲突解决。`sh -n .githooks/commit-msg .githooks/prepare-commit-msg` 与 `git diff --check` 通过。既有 CI 已改为同一 CLI 并运行真实 Git 回归；仅完成本地验证与工作流配置核查，未声称远程 CI 执行。
- 本票未修改应用前后端、公开业务契约或安装主仓库 hook，故无需 front typecheck、Pylint 或 OpenAPI 再生；安装与自检仍归03。保留其他票据、README及既有完成记录。

- 2026-10-30（integration 整合）：票02实现分支提交 `7bc2a5d1` 已通过合并提交 `e62c6804` 整合到 `codex-visual-engineering-checks`；无冲突，复用以上已通过检查记录，未修改相关实现或重跑无变化检查。`Status` 保持分诊状态 `ready-for-agent`，以 `Completion: integrated` 标记交付状态。
