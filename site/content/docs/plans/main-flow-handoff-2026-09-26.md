---
title: "AI 短剧工作台主流程整改（需求一）交接文档"
description: "批 1（A1–A4 / B1）与 B2a / B2b 已完成并推送 fork；本文记录确切状态、必须遵守的执行铁序、regen 的三个前置事实，以及重申铁约束。写给下一个接手这条线的会话，先读完再动手"
weight: 12
---

> **用途**：需求一（9 条清单）主流程整改的**交接文档**。
> 下一个接手这条线的会话请**先读完本文再动手** —— 里面有几条顺序是**用真实事故换来的**，
> 重排会直接造成功能真空或丢提交。

## 一、当前状态（截至 `abfde69`）

### 已完成并提交

| 台账 | 需求条目 | commit | 说明 |
|---|---|---|---|
| A1 | 第 4 条（P0 阻断） | `e46c3b3` | 同身份角色提示词差异化 + 跨资产查重的**假阳性**修复 |
| A2 | 第 2 条第 4 项 | `9c849f7` | 人物参考图改「角色设定图」版式（左面部特写 + 右全身三视图） |
| A3 | 第 2 条第 3 项 | `abfde69` | 画幅按类型拆分：人物 / 场景 16:9、道具 **1:1** |
| A4 | 第 2 条第 1/2 项 | `a91529a` | 资产批量勾选补「全选」+ **常驻**「批量生成图」 |
| B1 | 第 1 条前半 | `368740c` | 剧集名可编辑（**已核实不需要改库**） |
| B2a | 第 6 条 | `a0708d3` | 资产级声音绑定（复用 `file_usages`，**零迁移**） |
| B2b | 第 6 条 | `e27e777` | 镜头未表态时从绑定资产带出声音（多候选**不替用户选**） |

### 状态快照

- `HEAD` = `abfde69`；**本地 = 远端** = `fork/codex/jellyfish-production-pipeline`（`graspyourdream-sudo/Jellyfish`）。
- **工作区干净**：只剩一份**不属于本任务**的未跟踪文件
  `site/content/docs/plans/frontend-tech-info-layering.md`（需求三的文档）。
- 后端：**1324 passed / 13 failed**；那 13 条是 `meta: None` 信封类**既有基线**
  （用 `git archive HEAD` 起干净基线逐条核对过），**零新增失败**。
- 前端：`tsc --noEmit` **exit 0**；`corepack pnpm test` → **700 tests / 0 fail**。

### 未完成

`regen 窗口`、`B2a 第 2 步 UI`、`B2c`、`B2d`、`B2e`、`B3`、批 3（C1 / C2）、批 4（C3 / D1 / D2）。

---

## 二、执行铁序（**不许重排**）

```
regen（独立 chore commit）
  → B2a 第 2 步 UI
    → B2c
      → B2d
        → B2e
          → B3
            → 批 3（C1 / C2）
              → 批 4（C3 / D1 / D2）
```

**为什么这个顺序不能动**（两条各有硬证据，不是偏好）：

1. **regen 必须排在最前**：B2a 的第 2 步 UI 要调 `asset-voices` 端点，而 AGENTS.md 要求
   「前端统一走 OpenAPI generated client，**不新增手写 service 封装**」。
   `dramaPlanApi.ts`（需求二）已经是第一个口子，**再开第二个就收不回来了**；
   手工剪 `generated/**` 同样否决 —— 生成物必须机器独占，手剪之后下次 regen 的 diff
   永远不可审。
2. **B2c 必须在 B2a 第 2 步 UI 之后**：已实测核实 ——
   `ShotAudioBindingSection` 全站**只有一个使用点**（`ChapterStudio.tsx:5649`），
   分镜编辑页**没有**（0 处）。它是**目前唯一能绑声音的 UI**。
   在 B2a UI 上线前拆掉它，会留下「**完全没有地方绑声音**」的中间态功能真空。

---

## 三、regen 的三个前置事实（**动手前必须逐条确认**）

### 1. 产物在 `stash@{0}`，两条命令可重建

```
stash@{0}: On pr41-latest: regen-wip-abfde69-blocked-by-product-AssetKind
```

**新会话先确认这个 stash 还在**（`git stash list`）；不在就按下面两条命令重建，
不要在不确定的状态下重复 regen：

```bash
# ① 离线取快照（不碰 8000 端口；格式与线上 curl 取回逐字一致：
#    ensure_ascii=False + separators=(",", ":") ）
cd backend && .venv/bin/python -c "
import json
from app.main import app
open('../front/openapi.json','w',encoding='utf-8').write(
    json.dumps(app.openapi(), ensure_ascii=False, allow_nan=False, indent=None, separators=(',', ':')))
"
# ② 跑 codegen（注意：脚本内部调 `pnpm exec`，而 pnpm 不在 PATH，
#    因此直接跑同一份二进制）
cd ../front && ./node_modules/.bin/openapi \
  --input ./openapi.json --output ./src/services/generated \
  --client fetch --useOptions --useUnionTypes
```

- **建议用离线快照，不要重启在跑的后端**：离线方式从 worktree 的 app 对象取，
  「拉错目录」这条风险**从根上消失**，也不打扰用户正在用的页面。
- **验收口径**：重跑一次上面两条命令后 `git diff` **逐字节不变**。
  实测指纹 `3c3cca86…`（注意 macOS **没有** `sha256sum`，要用 `shasum -a 256`；
  用错命令会得到空对空比较，看起来"通过"其实无效）。
- chore commit **只含** `front/openapi.json` + `front/src/services/generated/**`，
  message 写「regen 追平后端 @&lt;HEAD-sha&gt;」。范围实测正确：路径数 138 → **159**，
  含 `asset-voices` 两条。

### 2. 8000 端口有**双监听**，且现有进程跑的是旧代码

- `lsof -nP -iTCP:8000 -sTCP:LISTEN` 有**两个**监听者：
  `pid 1964`（`*:8000`，cwd = `jellyfish-pr41/backend` ✅ 是对的）与
  `pid 63134`（`127.0.0.1:8000`）。**动手前先确认到底是谁在应答**。
- `pid 1964` 是在本批提交**之前**启动的，且 uvicorn 命令**没有 `--reload`**
  —— 它的 OpenAPI **不包含** `asset-voices` 等新路由。
  因此如果坚持用 `pnpm run openapi:fetch`，**必须先重启后端**，
  且**显式 `JELLYFISH_DRY_RUN=1`**；不重启就会拉到含新端点的**假象之外**的旧快照。

### 3. `ChapterShotEditPage.tsx:182` 的类型错**归属商品线（需求二）**

regen 一追平 `openapi.json` 就暴露（旧客户端把它藏住了）：

```
src/pages/aiStudio/shots/ChapterShotEditPage.tsx(182,43): error TS2322:
  Type '"scene" | "prop" | "costume" | "product"' is not assignable to type 'AssetKind'.
```

```ts
function overviewTypeToAssetKind(kind: ShotAssetOverviewItem['type']): AssetKind {
  return kind === 'character' ? 'actor' : kind   // ← kind 现在可能是 'product'
}
```

**根因**：需求二的商品线把 `product` 加进了后端 `ShotAssetOverviewItem.type`
（读取侧枚举同步），但**没有更新这个消费点**；`AssetKind` 里没有 `product`。

**归属与处置（已拍板）**：**由商品线修**，本任务不越线改别的功能线的消费点。
**若届时商品线未修**：**报备并等授权**，再决定是否由本线代修（代修必须是**独立的一个
fix commit**，不能捆进 regen 的 chore commit）。
历史处理方式：regen 产物当时**没有提交**，而是收进 `stash@{0}`（未删除、可还原），
避免把 40+ 个不属于本任务的生成物留在工作区被并行线卷走。

---

## 四、铁约束重申

1. **一项一 commit**，message 必须带**台账编号**（如 `fix(studio): A1 …`）。
2. **不混 hunk**；**共享文件严禁整文件暂存**，必须按 hunk 显式拆分。
   - 已验证可用做法：`git diff -- <file>` 自己切 hunk → `git apply --cached --recount <patch>`；
     每次 commit 前贴 `git diff --cached --name-status` 核对暂存区**只含本项**。
   - 若一个**新文件**同时覆盖两个台账项（如 A2 与 A3 共用一个测试文件），
     应**先把该文件拆成两份**——否则先提交的那一项必然带着后一项的断言、commit 是红的。
3. **真实付费出图 / 出视频一律演练模式验证**；真实调用**逐次**向用户确认。
4. **改正式库 / 删文件 / 改启动方式或端口或 .env** —— **先报备**。
5. **共享分支禁止 `rebase` / `amend` / `force-push`**。
   （本条今天已是**第三次**出现实证：需求三被丢过一次 commit，编号 `9b4e194` 的
   message 里写着「重做：原提交被并行工作线的历史重写丢掉了」；
   本任务的 B2a / B2b 一度也悬在同一条被重写过的历史上，靠 fast-forward 推送才保住。
   **请把这条明确发给所有并行线**。）
6. **不提交**：`.env`、数据库、`outputs`、缓存、生成图片 / 视频、大体积临时文件。
7. 推送前必须**先验 fast-forward**：
   `git merge-base --is-ancestor <远端tip> HEAD && git push …` —— 不做非 FF 推送。

---

## 五、两条来自本轮的工程经验（不是流程，是结论）

1. **门禁的假阳性也会阻塞主流程**。A1 修完差异化后仍然卡在生图前，
   因为跨资产查重拿**整条**提示词算相似度，而角色设定图的版式词很长、
   **本来就该人人相同** → 两个真被区分开的角色被判成 96% 重复。
   修法是把比较基准换成「剔掉后端确定性补齐的共享版式 / 画质 / 负面词之后的
   **资产特有内容**」——**不是**放宽门禁（内容真的没区分开时相似度仍是 100%，照旧 409）。
2. **「绑到资产」这类迁移要同时检查"旧入口是不是唯一入口"**。
   B2c 的功能真空就是这么被发现的：不是逻辑问题，是**入口唯一性**问题
   （`ShotAudioBindingSection` 全站 1 处、分镜编辑页 0 处）。

---

## 六、参考

- 需求原文（9 条清单）：用户 2026-09-26 提供，本任务按 第1条→B1+D1、
  第2条→A2+A3+A4、第3条→D2、第4条→A1、第5条→B3、第6条→B2、
  第7条→C2、第8条→C1、第9条→C3 映射。
- 禁词口径以 `site/content/docs/plans/frontend-leak-audit-2026-09-26.md` 为准。
- 需求三执行状态见同一文档 §7.4（**全部 7 个区域 + 序 0 + 插批 §5.5-C 已完成**）。
