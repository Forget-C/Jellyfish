# Issue tracker: Local Markdown

本项目的 Agent 规格与任务保存在 `.scratch/`，使用本地文件操作读写。

## 文件约定

- 每个功能一个目录：`.scratch/<feature-slug>/`。
- 规格：`.scratch/<feature-slug>/spec.md`。
- 实现票据：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 起按依赖顺序编号，每张票据独立成文件。
- 分诊状态写在票据顶部的 `Status:` 行，取值见同目录的 `triage-labels.md`。
- 票据依赖写在 `Blocked by:` 行，列出阻塞票据的编号；没有依赖时写 `None`。
- 评论和讨论追加在文件末尾的 `## Comments` 下。

## 技能操作

- **发布到任务系统**：在 `.scratch/<feature-slug>/` 下创建对应规格或票据文件，目录按需创建。
- **读取票据**：读取用户指定的路径；只有编号时，在当前功能的 `issues/` 目录解析，存在歧义时再确认。

## Wayfinding operations

`/wayfinder` 的决策地图也使用本地文件：

- **Map**：`.scratch/<effort>/map.md`，保存 Notes、Decisions-so-far 和 Fog。
- **Child ticket**：`.scratch/<effort>/issues/NN-<slug>.md`；`Type:` 记录 `research`、`prototype`、`grilling` 或 `task`。这类决策票据的 `Status:` 使用 `open`、`claimed`、`resolved`，与普通实现票据的分诊状态分开处理。
- **Blocking**：`Blocked by: NN, NN`。所有阻塞票据均为 `resolved` 后才解除阻塞。
- **Frontier**：查找尚未解决、没有阻塞且未被领取的决策票据，按编号选取。
- **Claim**：开始工作前将 `Status:` 改为 `claimed` 并保存。
- **Resolve**：在 `## Answer` 下追加结论，设为 `Status: resolved`，并将结论摘要及文件链接追加到地图的 Decisions-so-far。
