# 场次工作台体验回归

从项目根目录运行 27 项纯行为回归，使用现有 TypeScript 编译器与 Node.js 内置测试工具：

```bash
node --test front/tests/workspaceUsage.test.mjs front/tests/workspaceNavigation.test.mjs front/tests/workspaceContext.test.mjs front/tests/workspaceGuidance.test.mjs front/tests/workspaceTaskContext.test.mjs front/tests/workspacePreparation.test.mjs front/tests/workspaceProduction.test.mjs
```

浏览器回归需要 Node.js 20+、Playwright 及 Chromium；`workspaceUsage.browser.mjs` 还需 ffmpeg。可复用 Codex workspace runtime；如果 Playwright 不在项目模块路径，通过 `NODE_PATH` 指向提供该包的 `node_modules`，并使用该 runtime 的 Node.js。

```bash
node front/tests/workspaceUsage.browser.mjs
node front/tests/workspaceGuidance.browser.mjs
node front/tests/workspaceProduction.browser.mjs
```

三个脚本分别启动仅监听 `127.0.0.1:4178`、`127.0.0.1:4179` 和 `127.0.0.1:4180` 的临时 Vite，在真实页面中拦截业务接口，不连接生产后端，不调用真实生成模型。运行结束关闭浏览器和临时服务，并输出截图证据目录。

| 脚本 | 覆盖 |
| --- | --- |
| `workspaceUsage.browser.mjs` | A01–A04 采用与区间；八种旧入口、辅助定位、版本刷新、保存/放弃/取消、保存失败重试、不同草稿编辑器、并发审片及采用替换时的接缝保留。媒体为 ffmpeg 生成的六秒色卡。 |
| `workspaceGuidance.browser.mjs` | A05–A08 首次进入、下一步、来源变化、参考/能力拒绝定位、单元隔离、任务轮询与结果查看、焦点、章节/资产/任务往返、固定输入恢复和准备输入暂存及失败兜底。 |

| `workspaceProduction.browser.mjs` | A09–A12：同源设计摘要、六岗与声音各字段编辑/保存/刷新、其他字段及 Note 状态/来源完整保留、保存和写入失败、迟到建议、成功/失败/取消任务与完整历史、跨计划同名单元隔离、多个指令显式选择、固定参数与媒体类型，以及验证图/批量/重组的实际请求。 |

测试替身证明前端交互与请求边界。采用指针、不可变版本和事务规则由 `backend/tests/directing/test_store.py`、`test_continuity.py`、`test_feedback.py` 的现有业务测试验证；没有后端变化时复用已有结果。迟到建议的服务端独立派生由 `backend/tests/directing/test_workspace.py` 验证。UX4–UX5 的剪辑布局、完整设备覆盖、真实模型艺术质量和目标用户理解测试不由这些脚本代替。
