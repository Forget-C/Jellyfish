# 项目内部页与工作台统一：审查与修正

审查基线：规格及票据提交 `0b770681`。初次两轴审查终点：`e5f1a8dc`；审查覆盖基线后的实现及合并提交。本记录区分原始发现与后续修正，最终集成验收由主执行者补充。

## Standards 原始发现及修正

- **P2：项目资源与文件页重复页面留白。** 父级内容面板已提供桌面20px／手机16px，资源页再加同等padding，实际叠加为40px／32px。角色页用padding:0补偿，造成同组页面不一致。
- **修正：** 删除资源页额外padding及角色补偿规则，由父级唯一提供页面留白；同步长期规范。演员、场所／道具／服装、角色和文件的真实页面测试均增加标题左缘与首张卡片左缘相差不超过1px的几何断言，覆盖双主题和宽窄屏。演员旧实现先出现几何红测，修改后四套页面回归通过。
- 原始规范发现1项、代码气味0项；本项同时见Spec，属于同一个问题。

## Spec 原始发现及修正

1. **P2：历史场次的候选差异入口被写权限禁用。** 唯一候选入口沿用提取的editable限制，导致历史候选不能只读打开。修正为候选阅读仅受加载／提交／保存状态约束，提取和采用继续受原有写权限约束。新增真实候选生成后归档场次的回归，先复现入口disabled，再验证入口可打开、采用按钮禁用、更多中的重新提取禁用、关联编辑禁用，以及后端仍拒绝历史写入。
2. **P2：资源页重复留白。** 与Standards同一问题；修正及几何验证见上节。

原始Spec发现2项；两轴合计独立问题2项，均已完成修正及对应验证。未扩大后端接口、数据库或独立画布范围。

## 修正验证

以下命令在独立审查修正工作树执行：

- `PLAYWRIGHT_CHANNEL=chrome node front/tests/sceneObjectPreparation.browser.mjs`：通过完整对象准备流程及新增历史候选只读回归；最终证据目录 `/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-scene-objects-16MrrV`。
- `PLAYWRIGHT_CHANNEL=chrome node front/tests/projectActors.browser.mjs`：通过演员交互及双主题／四视口几何断言；证据目录 `/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-project-actors-ubkSdO`。
- `PLAYWRIGHT_CHANNEL=chrome node front/tests/projectResources.browser.mjs`：三类资源逐类通过交互与几何断言；证据目录 `/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-project-resources-KJtC1K`。
- `PLAYWRIGHT_CHANNEL=chrome node front/tests/projectRoles.browser.mjs`：通过角色交互及几何断言；证据目录 `/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-project-roles-079oDF`。
- `PLAYWRIGHT_CHANNEL=chrome node front/tests/projectFiles.browser.mjs`：通过文件浏览、预览、批量下载及几何断言；证据目录 `/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-project-files-1d2H7Q`。
- `pnpm --dir front run typecheck`：通过。
- `pnpm --dir front run lint:baseline`：只移除已经修复的2条旧any诊断，已知项由224降为222，未接受新诊断。
- `pnpm --dir front run lint:check`：通过，222项已知、0项新增。
- `git diff --check`：通过。

一次对象浏览器准备过程因隔离SQLite连接中断使Worker停止，重跑后完成预期红测和最终绿测；另一次准备将候选生成放在删除建议资产之后导致无候选，已调整为资产可用时生成真实候选再归档。均未为测试修改后端业务。浏览器测试仅证明前端及隔离环境行为，不代表真实供应商质量或生产部署；既有Browserslist过期与Node弃用提示未影响通过。
