# 工作台设计标准验证

2026-10-14。本轮范围：共享主题、动作、弹窗、长文预览，四画布共用工具栏、AI 设计和工作台任务中心接入；其余业务区见迁移清单。

- `pnpm --dir front run typecheck`：通过。
- `pnpm --dir front run build`：通过；开发示例路由和文案未进入产物。构建仍有既有大包、Browserslist 数据过期提醒。
- `PLAYWRIGHT_CHANNEL=chrome /opt/homebrew/bin/node front/tests/workbenchUi.browser.mjs`：通过。覆盖默认、主次、危险、禁用、加载、选中、键盘焦点、纯图标名称、长短文和桌面／窄屏弹窗滚动。
  - 证据：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-workbench-ui-QgCT2E`
- `sceneWorkbenchStyle.browser.mjs`：通过。覆盖四画布、菜单、草稿、视角、任务计数／过滤及浅色主题隔离。
  - 证据：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-workbench-style-NLVdFP`
- `sceneCopyDesignTasks.browser.mjs`：通过，生成中的设计持久化、复制限制和成功后未应用状态。
  - 证据：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-lT9FF0`
- `sceneDesignReferences.browser.mjs`：通过，设计来源恢复及应用错误处理。
  - 证据：`/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-version-OPlWel`
- `git diff --check`：通过。

浏览器回归使用本地测试数据，没有发起付费模型任务。截图供人工复查，未引入像素基线比较。浏览器脚本仍输出既有 Tailwind content 配置与 Node util._extend 弃用提醒。

本轮无后端改动；工作区中前轮来源校验修复及其他用户修改继续保留，未提交 commit。
