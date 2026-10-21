# 实施与验证

## 已落地

- frontend-checks 保持既有 job/status 名称，typecheck job 增加 lint 存量检查与前端纯逻辑全集；浏览器 job 改为统一入口串行执行八个工作台／graph 用例。
- 保留原始 `lint`，新增 `lint:check` 与只收缩的 `lint:baseline`。初始化登记当前 298 项问题（181 error／117 warning），不改应用代码、不关闭既有规则。指纹包含文件、规则、严重度、消息和源代码行摘要，行号移动不产生新豁免；新诊断与解析／工具失败阻断，旧问题解决后要求收缩。`--init` 拒绝覆盖已有基线。
- `browser-suites.json` 登记套件、用例、端口及超时；CLI 固定 cwd、先预检、检查端口、串行执行，成功简报、失败保留完整日志和 JSON。证据目录非空时拒绝复用，避免旧截图伪装本次结果。
- browser-runtime 统一证据目录、完整后端日志和幂等资源清理。POSIX 用独立进程组兜底；补充了父进程提前退出、子进程忽略 SIGTERM 且关闭输出管道的回归，先红复现残留端口，再修复为组清理。
- graph 夹具统一改名展示节点／边／视图和本地／当前跨画布目标，保留业务身份。长摘要旅程已使用两种完整改名图，真实进入单元和导演子图；其他旅程复用同一映射工具，保留原有断言。
- code-review skill 按条件读取来源索引，并忽略文件名大小写查找额外标准。索引只导航，不复制原规则；AGENTS.md 未增加内容。

## 验证结果

- CLI 新边界由用户确认后先红后绿：串行／跨 cwd／日志、占用端口保护、超时进程树清理、lint 新问题阻断与基线收缩、失败停止、中断退出。
- `pnpm --dir front run test:unit` 最终成功，188 项（原 182＋6 项公开 CLI），dot reporter 输出收敛；完整日志 `/tmp/jellyfish-guardrail-final-unit.log`。
- `pnpm --dir front run typecheck` 通过；`lint:check` 通过：298 项已知，0 新增。原始 lint 仍报告存量，未宣称全仓无 lint 问题。
- 统一 `test:browser` 成功，证据 `front/test-results/browser-J1lbOa`：preflight 1.1s、workbench-ui 4.6s、style 62.0s、design-scope 15.2s、director-layout 9.9s、canvas-graph 27.8s、graph-summary 6.6s、legacy-graph 6.2s、periodic-save 10.2s。最终 CLI 进程树修复另有全部 6 项命令回归通过；正向套件行为不变。
- 工作流 YAML 解析、清单八项路径、JS 语法及 diff --check 通过。生产前后端接口和业务代码未改，未要求生成 OpenAPI 或重跑后端全集；真实浏览器仍使用正式隔离 HTTP 后端。
- 当前本地为 POSIX／Chrome；GitHub Ubuntu／Chromium job 尚未远程执行，不将本地结果等同远程 CI。端口检查不是操作系统级预留，不支持另外并行运行相同固定端口的旧入口。

## 收尾

固定提交后进行独立 Standards／Spec 两轴审查，再记录修复与最终提交。
