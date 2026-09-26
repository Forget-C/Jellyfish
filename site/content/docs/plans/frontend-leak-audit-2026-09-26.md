---
title: 前台「三层信息模型」泄漏审计清单（静态扫描 + 运行时只读走查）
date: 2026-09-26
description: 对 front/src 全量主区文案做三层信息模型审计，逐条给出「文件:行号 → 泄漏模式 → 当前原文 → 中文人话口径」，并附阶段 B 执行计划与验收方案
tags: [plan, 审计, 文案, 三层信息模型, 前台]
authors: [maintainer]
---

## 1. 结论与审计范围

**一句话结论**：`front/src` 共 **271 条**主区泄漏，分布在 7 个页面区域、6 类模式上；其中 **模式 6（后端原文直渲）74 条、模式 2（后端字段名）60 条、模式 3（英文枚举）52 条**为三大重灾区；**绝大多数泄漏的根因不是"把后端值写死在文案里"，而是"在渲染点把后端值直接渲出来"**——因此阶段 B 的修法必须落在**渲染点 / 映射层**，只改文案字符串无效（例证见 §5.6）。

### 审计范围与方法

| 项 | 内容 |
|---|---|
| 扫描目标 | `front/src/`（`pages/**`、`services/**`、`components/**`、`layouts/**`、`store/**`、`locales/**`、`main.tsx`、`App.tsx`），约 8.9 万行 TS/TSX |
| 方法一 | **静态扫描**：`grep` / `read` / `glob` 精确到行，逐条人工判读上下文与折叠默认值 |
| 方法二 | **运行时只读走查**：真实模式浏览器走查，覆盖 18 个页面区域 |
| 请求账目 | 只读 GET **1052**；只读 preview POST **7**（`image-pipeline/plan/preview` ×5、`video-plan/preview` ×2，页面加载自动触发）；可能写入的非 GET 非 preview **0**；守卫拦截 **0** |
| 未点击按钮 | 分析本章资产、批量生成选中项、批量重新生成已选项、生成图片、生成提示词、生成这一镜、生成视频、采纳、设为定版、删除、保存到镜头、确认保存、提交类、任务中心「取消」、添加供应商、保存基础信息 |
| 审计日期 | 2026-09-26 |
| 被测项目 | `2d0af44e-…` 御兽嫡长女 / 第 1 集 `33696d3f-…` |
| 产物 | 截图 82 张 + 文本 41 份存放于 `~/Desktop/jellyfish-验收截图/audit/`（**未进仓库**） |
| 约束 | 全程只读：未修改任何产品代码、未 commit、未 push、未跑测试、未触发付费调用 |

### 基准口径（沿用仓库既有约定，不另立标准）

- 禁词表 `front/src/pages/aiStudio/project/ProjectWorkbench/components/workbench/workbenchState.ts:544-587`
  - `MAIN_SCREEN_FORBIDDEN_TERMS`（19 词）：`候选` `聚合` `检查中` `槽位` `项目内资产` `全局资产` `提示词质量未知` `最终提示词` `生成依据` `接口名` `供应商` `任务号` `file_id` `内部状态` `asset_id` `service_task_id` `source_task_id` `oss_url` `provider`
  - `MAIN_SCREEN_FORBIDDEN_SOURCE_TERMS`（源码级 12 词）：上表去掉 `接口名` `内部状态` `asset_id` `service_task_id` `source_task_id` `oss_url` `provider`（这些在契约里就带，代码读它们属正常）
- 内部术语表 `front/src/pages/aiStudio/project/ProjectWorkbench/components/userFacingStatus.ts:15-27`（更严）：另有 `deepseek-chat` `gpt-image-2` `image2` `status: ready` `status=ready` `门禁` `DRY_RUN` `JELLYFISH_` `provider_id`
- 已实现的三层机制：`front/src/pages/aiStudio/components/maskInternalIds.ts`（把 UUID / `file_id=` / `storage_key=` / 裸字段名替换为「（内部 ID 见「技术详情」）」或中文标签）
  - **全仓仅 4 处真实引用**：`ChapterStudio.tsx:6451,6477,6575`、`ShotBoundFilesPanel.tsx:131`、`assetPromptQuality.ts:486,621,665,808`、`assetProduction.ts:1132`
  - `services/` 全域引用数 **0**

---

## 2. 三层信息模型与 6 类泄漏模式

### 2.1 三层信息模型

| 层 | 默认状态 | 允许放什么 | 例 |
|---|---|---|---|
| **主区** | 展开 | 用户要**决定**的事：名称、中文业务状态、缺失项、推荐操作、结果图/视频、调用次数与金额 | 「待补资料」「可以生成」「部分失败（成功 3/共 5）」 |
| **折叠依据层** | 收起 | 生成依据、质量原因（**用中文转述**） | 「这次用了本章资产资料 + 结构化资料」 |
| **技术详情层** | 收起 | 内部 ID/UUID、`file_id`/`storage_key`、供应商与**原始模型名**、接口路径与参数、任务号、**英文枚举原值**、后端错误原文 | `service_task_id: svc-1`、`/api/v1/studio/…`、`partial_failed` |

> **判定铁律：主区出现第三层内容 = 泄漏。**
> 折中情形同样计为泄漏：**折叠区的标题/说明在收起状态下可见**，所以「技术详情」这个折叠块的标签文案本身必须干净（例：`ShotProductionWorkspace.tsx:153` 的标签正文就含 `供应商 / 内部 ID / file_id / storage_key`）。

### 2.2 参考标准（外部产品直觉）

「巨日禄」这类成熟产品的用户界面只回答三件事：**做什么 / 现在什么状态 / 结果在哪**。用户不需要知道任务编号、模型名称、接口地址、字段名——这些是实现细节，只服务于**报障与运维**，因此统一收进默认收起的「技术详情」是正确且充分的产品答案。

### 2.3 6 类泄漏模式

| # | 模式 | 定义 | 典型原文 |
|---|---|---|---|
| **1** | 内部 ID/UUID 直渲 | `task_id` / `source_task_id` / `service_task_id` / `asset_id` / `file_id` / `shot_id` / `project_id` / `provider_id` 的**值**上了屏 | `file_id=1ebace78-…`、`项目：2d0af44e-…` |
| **2** | 后端字段名直渲 | 字段名本身作为文案/标签出现 | 「该帧槽位没有 file_id」「image_prompts 为空」「raw_keys」 |
| **3** | 英文枚举/状态码直渲 | `running`/`failed`/`pending`、`asset_type` 原值、景别 code、`outcome`、`partial_failed`、`dry_run`；含 HTTP 状态码与英文检查码 | `状态：ready`、`未通过 · extraction_ready`、`后端状态：succeeded` |
| **4** | 接口路径/URL 直渲 | `/api/v1/...`、`http://...`、`localhost`/`127.0.0.1`/`192.168.*`/`10.*`/`*.local`、OSS object key、环境变量名、仓库文件路径 | `POST /api/v1/studio/image-pipeline/video-submit`、`JELLYFISH_DRY_RUN=0`、`http://***1:4321/v1` |
| **5** | 供应商/模型名直渲 | `apimart`、`prov-xxx`、`deepseek-chat`、`gpt-image-2`、`seedance-2.0-mini`、`image2` | `供应商：apimart`、`固定模型：seedance-2.0-mini` |
| **6** | 后端原文直渲 | `message.*` / `notification.*` / `Modal.*` / JSX 里直插 `detail`、`error.message`、`reason`、`warnings[]`、`provider_notes`、HTTP 响应体 | `保存视频提示词失败：Generic Error: status: 500; body: {…}` |

---

## 3. 统计总表

### 3.1 按模式

> **计数口径**：以 §4 逐页清单里的**每一条 bullet** 为单位（一个 bullet = 一个渲染点/一个文案节点；`（同款 :xxxx）` 是在同一条内并列的兄弟行号，不另计）。下表为对 §4 的机器统计结果，与 §4 完全自洽。
> 「运行时独占」= 仅运行时走查发现（第 1/2/3 轮合计）、静态扫描未命中的条目，共 **12 条**（其源码落点已在 §5.1 与 §5.5 给出）；另有 **25 条**同时被两路命中，在 §4 标 **【静态+运行时】**。

| 模式 | 条数 |
|---|---|
| 1 内部 ID / UUID 直渲 | **27** |
| 2 后端字段名直渲（含基准禁词命中） | **60** |
| 3 英文枚举 / 状态码直渲 | **52** |
| 4 接口路径 / URL / 本机内网地址 | **35** |
| 5 供应商 / 模型名直渲 | **21** |
| 6 后端原文直渲 | **74** |
| 渲染缺陷（非 6 类，记录项） | **1** |
| 跨模式合并条目（同一行命中 4 类，见 §4.6） | **1** |
| **合计** | **271** |

模式 6 的 **74 条**里，约 20 条是 `catch → message.error(err.message)` 的同型复制（`ChapterStudio.tsx` 一族归并为一条），改**一个管道**即可覆盖大半（见 §3.3 与 §7.1-5）。

### 3.2 按页面区域

| 页面区域 | 条数 | 最严重的一条 |
|---|---|---|
| 1. 项目大厅 / 新建向导 | **5** | `ProjectLobby.tsx:1086` 新建向导 tooltip 就把「供应商」给了用户（本区域最干净） |
| 2. 工作台五步 | **53** | `workbench/AssetWorkbench.tsx:405` + `assetWorkbenchContract.ts:373` 的运行中降级警告条（主区最大面积，且是开发术语） |
| 3. **ChapterStudio** | **63** | `ChapterStudio.tsx:7484-7524` 整块把 `POST /api/v1/...` + `Celery/Redis/worker` + `pending` + `seedance-2.0-mini` + `供应商：${provider}` 摊在主区 |
| 4. 任务中心 / 任务通知 | **34** | `GenerationGateBanner.tsx:62` `状态：{info.state}` 直渲 `ready/dry_run/not_configured…` |
| 5. 提示词看板 / 资产抽屉 / 待处理抽屉 | **25** | `AssetCardGrid.tsx:158,162` + `AssetDetailDrawer.tsx:63,135` 卡片正面直渲后端 `status.reason` 与 `quality.reasons` |
| 6. 实体管理 + 镜头/编辑器/文件/模板/编排/Agent | **63** | `AssetEditPageBase.tsx:2316-2328` 结果行四模式挤一行 + `assetResultSummary.ts:511-521` 枚举原值拼进中文失败句（**每次出图都会命中**） |
| 7. 设置 / 模型页 + 服务层 | **28** | `Settings.tsx:18,30,34,55,58` 整页 i18n key 原样上屏（首屏即见，同类根因也命中 404 页） |
| **合计** | **271** | |

§5.1 的运行时可见原文（R1–R27）与 §5.5 的追加发现**不另计数**：其中 25 条已并进上表对应条目（标 **【静态+运行时】**），12 条为运行时独占（标 **【运行时】**，已计入上表）。

### 3.3 模式 6 的出口分布

| 出口类型 | 出口数 | 说明 |
|---|---|---|
| `message.(error\|warning\|info\|success)` | **69** | 总数 555 处中的 12.4% |
| ├ 直接字段插值 | 41 | 正则 `\.(message\|detail\|reason\|error)` 命中，去掉 4 处假阳性 |
| ├ 经 helper 包装 | 17 | `failureText` ×6、`describeEnvelopeError` ×4、`defaultTaskActionErrorMessage` ×3、`getErrorMessage` ×3 —— **最易漏的一类** |
| └ 变量直传 | 11 | `notes[0]`(provider_notes)、`msg`(body.detail)、`errorMessage`(data.error) 等 |
| `notification.*` | **0** | 2 个调用点全用中文模板，`taskId` 仅作 React `key` |
| `Modal.*`（content / description / okText） | **2** | 55 个调用点中的 2 个（含 1 个死代码） |
| JSX 裸渲后端字段 | **约 20 个渲染点** | 结果卡片/抽屉 4 · 列表单元格 3 · Alert 提示块 9 · warnings 列表 4 |
| `throw` → `catch` → 上屏链路 | **10 条** | 源头 6 个：`llmPipelineApi.ts` ×3、`orchestrationStatusApi.ts`、`generationGate.ts`、`promptFlow` |
| **顶层 ErrorBoundary 整页直渲** | **1** | `main.tsx:44-51`（第 2/3 轮实测：不存在项目 ID → 整页英文 React 运行时原文，见 §5.5-A1） |
| **Alert `description` 直渲后端动态文本** | **2** | `ShotAudioBindingSection.tsx:330,337`（`excluded_reason`，**未掩码**）、`ChapterShotAssetBindingSection.tsx:428-440`（`previewError`） |
| **汇总/兜底文案把枚举原值拼进中文句** | **1** | `assetResultSummary.ts:511-521 fallbackFailureText()`（`partial_failed` / `failed` / `running`，见 §5.5-B1） |
| **模式 6 出口合计** | **约 105 个出口** | |

### 3.4 模式 4 的出口分布

| 出口类型 | 出口数 | 落点 |
|---|---|---|
| 文案字符串里的接口路径 / URL | **15** | `ChapterStudio.tsx:7486,7491`、`ProjectDevInfo.tsx:10-14,294-298`、`RealRunModeBadge.tsx:189`、`LlmPipelinePage.tsx` 等 |
| 文案里的环境变量名 / 仓库文件路径 | **4** | `JELLYFISH_DRY_RUN` / `JELLYFISH_CONFIRM_REAL`、`backend/.env`、`docs/real-run-mode.md`、`SIX_STEP_ACCEPTANCE.md` |
| `window.open(...)` | **4** | `FilesTab.tsx:13-14,17-21`（调用点 `:119,126` 打开 `/api/v1/studio/files/{id}/download`）、`ChapterStudio.tsx:2623,6299` |
| `<a href={...} target="_blank">` | **2** | `LlmPipelinePage.tsx:1006`、`AssetEditPageBase.tsx:2321-2322`（均为完整 OSS 地址可见可点） |
| **JSX `title` / `tooltip` 悬停属性** | **3** | `ProvidersTab.tsx:269,539,581`（第 2/3 轮实测 `title="http://***1:4321/v1"` 等，**悬停即见**；纯文本扫描抓不到） |
| `<img>` / `<video src={...}>` | **2** | `FilesTab.tsx:268`、经 `resolveAssetUrl` 的 3 个缩略图点（`ActorsTab.tsx:139`、`AssetTypeTab.tsx:192,234`） |
| 文案里的存储形态（`asset://` / `/files/...`） | **2** | `ShotAudioBindingSection.tsx:256`、`audioAdmissionCore.ts:73` |
| 复制按钮（`navigator.clipboard.writeText`） | **0** | 6 个调用点全部只复制提示词/交付文本，**无 URL 复制** ✅（第 2/3 轮实测点过一次「复制交付文本」，剪贴板 6650 字正文对模式 1/4 正则 **0 命中**） |
| **模式 4 出口合计** | **32 个出口** | 静态条数 35（含同一出口的多处文案） |

### 3.5 测试护栏现状

真正做**源码级**禁词扫描的只有 2 处，且都不覆盖重灾区：

| 现有护栏 | 扫描对象 | 词表 | 豁免 |
|---|---|---|---|
| `workbench/workbenchState.test.ts:445-469` | **硬编码 6 个文件名**（全在 `components/workbench/`） | `MAIN_SCREEN_FORBIDDEN_SOURCE_TERMS`（12 词） | 唯一 `TechnicalDetailCollapse.tsx` |
| `components/userFacingCopy.test.ts:113-139` | `ProjectWorkbench/**` + `assets/**` 全量源码；另有 `OUT_OF_SCOPE_OFFENDERS` 登记表 | 只有 `['垫图','图生图']` | 登记表内 7 个文件 |
| `components/userFacingStatus.test.ts` | 只断言 `userFacingStatus.ts` **自己产出的**文案 | `FORBIDDEN_INTERNAL_TERMS`（11 词） | — |
| `components/assetProduction.test.ts:990-1002` | 只扫 `assetProduction.ts` 静态常量输出 | `INTERNAL_TOKEN_BLACKLIST`（**最全 25 词**） | — |

**完全没有禁词扫描的页面/目录**：`chapter/**`（含 6600+ 行的 `ChapterStudio.tsx` —— 最高优先级盲区）、`shots/**`、`editor/`、`files/`、`prompts/`、`promptFlow/`、`llmPipeline/`、`agents/`、`components/**`（`TaskCenter`、`GenerationGateBanner`、`RealRunModeBadge`、`task*`、`generation*`）、`models/**`、`pages/Settings.tsx`、`layouts/MainLayout.tsx`、`main.tsx`、`App.tsx`、`services/*.ts`、以及 `ProjectWorkbench` 的全部 `tabs/**`、`components/*.ts` 文案源与 `components/Project*.tsx`。

**四张禁词表互不同步**：`MAIN_SCREEN_FORBIDDEN_TERMS`(19) / `MAIN_SCREEN_FORBIDDEN_SOURCE_TERMS`(12) / `FORBIDDEN_INTERNAL_TERMS`(11, 含 `DRY_RUN`/`门禁`) / `INTERNAL_TOKEN_BLACKLIST`(25, 含 `apimart`/`celery`/`partial_failed`)。建议阶段 B 合并为一份、按层分组。

**两处「反向锁死」**（改文案时必须同步改测试，否则整改会被误读为回归）：
- `generationStatusCore.test.ts:52` 断言 `description` 必须含 `gpt-image-2`；`:141/:147/:152` 断言后端原文（含 `POST /api/v1/script-processing/extract`）必须进 `failure.reason`
- `audioAdmissionCore.test.ts:39,59,134` 把「已绑定，但供应商无法访问」冻结成断言
- `assetPromptSlots.test.ts:117,210` 反向锁定「不支持（无槽位）」「后端槽位表里还没有」
- `workbenchState.test.ts:391` 把「未知资料字段原样返回英文键」钉成期望值

---

## 4. 逐页清单（核心）

> 格式：`- [模式 N] 文件:行号 ｜ 当前文案：\`原文\` ｜ 建议口径：\`中文人话\``
> 标注 **【静态+运行时】** 表示该条同时被静态扫描与运行时走查命中；标注 **【运行时】** 表示仅运行时可见。
> 路径均相对于 `front/src/`。行号已逐条 `read`/`sed -n` 复核。

### 4.1 项目大厅 / 新建向导

#### 模式 1
- [模式 1] `pages/aiStudio/project/ProjectLobby.tsx:633,726,964`（`formatProjectTime(p.createdAt)`）｜ 当前文案：项目卡片/详情显示项目名 `孤立项目 script_9c3aafd08a（迁移）` **【运行时】** ｜ 建议口径：`数据侧问题——项目名被写成内部标识，建议在运营侧改名；前端可在名称形如「孤立项目 <hash>（迁移）」时折叠显示为「未命名项目（迁移）」并把原名放进技术详情`

#### 模式 2
- [模式 2] `pages/aiStudio/project/ProjectLobby.tsx:54,92,360-364` ｜ 当前文案：排序下拉显示 `排序 createdAt ↓`（枚举 `SortKey = 'updatedAt' | 'name' | 'createdAt' | 'chapters'` 直接进选项） **【运行时】** ｜ 建议口径：`「排序：创建时间（新→旧）」`
- [模式 2] `pages/aiStudio/project/ProjectLobby.tsx:839` ｜ 当前文案：`{ label: '最近更新', value: 'updatedAt' }` ｜ 建议口径：`「最近更新」保留，但 value 只作内部键不上屏（现状正确，登记以防回退）`

#### 模式 5
- [模式 5] `pages/aiStudio/project/ProjectLobby.tsx:1086` ｜ 当前文案：`tooltip="可选预设，也可直接输入自定义比例（格式如 9:16）；留空则由模型/供应商决定"` ｜ 建议口径：`「留空则由系统默认画幅决定」`（新建向导阶段用户还没接触模型选择，「供应商」是点名禁词）
- [模式 5] `pages/aiStudio/project/ProjectLobby.tsx:1136` ｜ 当前文案：与 `:1086` 完全同句（编辑项目弹窗复制一份）｜ 建议口径：同上

**本区域小结**：`ProjectLobby.tsx` 的 5 处 `message.*` 全是静态中文兜底（`:404 批量删除失败`、`:467 创建失败`、`:516 更新失败`、`:526 删除失败`），**没有**直插后端 `detail`；`ProjectWorkbench.tsx`、`projectStartPresets.ts`、`useProjectStyleOptions.ts`、`ProjectVisualStyleAndStyleFields.tsx` 未命中任何一类模式。

### 4.2 工作台五步（`project/ProjectWorkbench/**`）

#### 模式 1
- [模式 1] `pages/aiStudio/project/ProjectWorkbench/components/JuriluScriptGroupPicker.tsx:213` ｜ 当前文案：`` {`脚本组 ${group.script_id}`} ``（单选框主标题）**【静态+运行时】**（运行时见「批量导入表头『脚本组（script_id）』」）｜ 建议口径：`` `「脚本组 ${序号}（${recordCount} 条）」`，内部组编号移入折叠区 ``
- [模式 1] `pages/aiStudio/project/ProjectWorkbench/components/JuriluScriptGroupPicker.tsx:319` ｜ 当前文案：`` {selected ? `用这一组匹配镜头（整组 ${selected.record_count} 条 · ${selected.script_id}）` : '用这一组匹配镜头（请先选一组）'} `` ｜ 建议口径：`「用这一组匹配镜头（整组 N 条）」`
- [模式 1] `pages/aiStudio/project/ProjectWorkbench/hooks/useProjectStepSignals.ts:238` ｜ 当前文案：`` name: item.name || item.asset_id, `` ｜ 建议口径：`` name: item.name || '未命名资产', `` —— 该 `name` 直接进资产表与步骤摘要，回退成内部编号等于把 UUID 当资产名
- [模式 1] `pages/aiStudio/project/ProjectWorkbench/components/ProjectImagePrepPanel.tsx:254`（同款 `:458`）｜ 当前文案：`` {record.name || record.id} `` / `` rowKey={(row, index) => `${row.source_task_id}-${index ?? 0}`} `` ｜ 建议口径：`若复用则改「未命名资产」；否则随 legacy 屏删除（该文件无渲染入口，`index.tsx:386` 注记「文件保留」）`

#### 模式 2
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/JuriluScriptGroupPicker.tsx:272` ｜ 当前文案：`` {`第一步记录的可用字段名（raw_keys）：${rawKeysText(group)}`} `` ｜ 建议口径：`` `「这一步读到的可用信息项：${中文项名}」`，英文字段名移入折叠区 ``
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/JuriluScriptGroupPicker.tsx:286`（同款 `:289`）｜ 当前文案：`locale={{ emptyText: '后端没有返回 sample_records：无法在此自检解析结果，请核对 raw_keys 后按实际分镜判断' }}` / `{ title: 'sbid', dataIndex: 'sbidText', width: 100 }` ｜ 建议口径：`「这次没有返回样例记录，无法在此核对解析结果，请按实际分镜判断」` / 列名改 `「剧本编号」`
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/JuriluScriptGroupPicker.tsx:129` ｜ 当前文案：`description="每个 scriptId 是一个独立的脚本组：本页默认不合并，也不会替你选中任何一组。…"` ｜ 建议口径：`「每次抓取拿到的每一组剧本都是独立的：本页默认不合并，也不会替你选中任何一组。…」`
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/AssetProfileEditEntry.tsx:207` ｜ 当前文案：`` 字段名与后端 `{fieldType}` 的资料表一致；留空表示"这一项没有信息"，不会写成空话。 `` ｜ 建议口径：`「这里填的内容和后端资料一一对应；留空表示『这一项没有信息』，不会写成空话。」`（`fieldType` 取 `character/scene/prop/costume` 原值）
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/ProjectDevInfo.tsx:261` ｜ 当前文案：`'无法判定（当前接口载荷未暴露 image_prompts）'` ｜ 建议口径：`「暂时读不到这项状态（内部字段名见下方『信号来源接口』）」`（在技术详情区内，属"允许但需收敛口径"）
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/ProjectDevInfo.tsx:10-14`（同款 `:294-298`）｜ 当前文案：`` ['项目角色', 'GET /api/v1/studio/entities/character?page_size=100（字段 project_id / thumbnail / image_prompts）'], `` ｜ 建议口径：`内容本身合规（技术详情层），但这是第二套技术详情实现（另一套是豁免组件 workbench/TechnicalDetailCollapse.tsx），建议统一到一处，否则无法做单点豁免测试`
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/workbench/AssetWorkbench.tsx:405`（文案源 `workbench/assetWorkbenchContract.ts:373,377,467`；`workbench/technicalView.ts:87`）｜ 当前文案：`message="等待后端契约：本章资产资料接口还没有就绪"` / `'本章资产资料接口还没有就绪（后端正在按契约实现）：下面是按既有数据拼出的降级视图，'` / `WORKBENCH_CONTRACT_PENDING_HINT = '等待后端契约：先按下面的降级视图查看已有资产与图片状态。'` / `status_label: '等待后端契约'` **【静态+运行时】**（运行时为步骤 2 三处黄色警告条，主区最大面积）｜ 建议口径：`「本章资产资料还在接入中：先按下面已有的数据查看资产与图片状态」` —— 去掉「等待后端契约 / 降级视图 / 后端正在按契约实现」这些**开发术语**
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/ProjectStudioStepPanel.tsx:351` ｜ 当前文案：`` {`可交付来源：${delivery.export_sources.map(sourceLabel).join(' / ')}`} `` **【静态+运行时】**（运行时见 `可交付来源：… / external_import / …`）｜ 建议口径：`sourceLabel 未登记时不许回落原值（见下条模式 3）`
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/ProjectStudioStepPanel.tsx:356-358` ｜ 当前文案：`{delivery.note ? <Typography.Text …>{delivery.note}</Typography.Text> : null}` **【静态+运行时】**（运行时见「imported_size / imported_resolution / recommended_duration 元信息在 Jellyfish 侧没有等价列，因此未提供」）｜ 建议口径：`后端 note 属动态原文，先过 maskInternalIds；「元信息 / 等价列」是开发说法，改「这些字段本项目暂时用不到」`

#### 模式 3
- [模式 3] `pages/aiStudio/project/ProjectWorkbench/tabs/ChaptersTab.tsx:537` ｜ 当前文案：`{ title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt', width: 160 }`（**无 `render`，原样渲染 ISO 字符串**）**【运行时】**（步骤 1 更新时间直渲 `2026-09-26T04:02:58.135Z`，2 行）｜ 建议口径：`加 render：formatProjectTime(value)（复用 ProjectLobby.tsx:76 的既有实现）`
- [模式 3] `pages/aiStudio/project/ProjectWorkbench/components/ProjectStudioStepPanel.tsx:48` ｜ 当前文案：`` return SOURCE_LABELS[key] ?? (key || '未设定来源') ``（未登记时**回显后端原值**）**【静态+运行时】** ｜ 建议口径：`` return SOURCE_LABELS[key] ?? '来源未记录' ``；该值经 `:177`「提示词来源」列与 `:351` 上主区
- [模式 3] `pages/aiStudio/project/ProjectWorkbench/components/ProjectDevInfo.tsx:214`（同款 `:269`）｜ 当前文案：`{row.providerStatus}` / `{resolution.step}` ｜ 建议口径：`在技术详情区内可接受，但需随上条一并收敛到统一组件`

#### 模式 4
- [模式 4] `pages/aiStudio/project/ProjectWorkbench/components/ProjectDevInfo.tsx:69` ｜ 当前文案：`` throw new Error(`GET ${path} 失败（HTTP ${response.status}）`) `` → 经 `:145 setModelLoadError` 渲染在 `:197` ｜ 建议口径：`` throw new Error(`读取模型与供应商信息失败（HTTP ${response.status}）`) ``，路径只在下方「信号来源接口」列
- [模式 4] `pages/aiStudio/project/ProjectWorkbench/components/AssetImagePromptLlmPanel.tsx:956` ｜ 当前文案：`` 提示词生成走后端 LLM 编排接口（`POST /studio/llm/image-prompt/preview`），每项一次调用。 `` ｜ 建议口径：`「提示词由后台的大模型生成，每项资产一次调用、一次计费。」`（在折叠标题内，但折叠标题收起时仍可见）
- [模式 4] `pages/aiStudio/project/ProjectWorkbench/components/assetProduction.ts:373`（同款 `:421`、`:536`、`:1014`）｜ 当前文案：`'该能力正在接入（后端端点还没上线），暂时不能使用；现在可以先用「重新生成参考图」。'` / `'…（出图接口一次只接受一个类型）'` / `` `…（出图服务没有取消接口）` `` ｜ 建议口径：`「这个能力还在接入中，暂时不能用；可以先点『重新生成参考图』」` / `「会按类型分几批提交」` / `「正在生成的 N 项会跑完，不能中途取消」`

#### 模式 5
- [模式 5] `pages/aiStudio/project/ProjectWorkbench/components/ProjectDevInfo.tsx:194`（同款 `:206-207`）｜ 当前文案：`<div>模型与供应商（内部标识）</div>` / `<span>供应商：</span> <code>{row.providerName}</code>` ｜ 建议口径：`技术详情区内允许保留，但需收敛到统一组件`

#### 模式 6
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/tabs/ActorsTab.tsx:121-126` ｜ 当前文案：`` typeof (e as { body?: { detail?: string } }).body?.detail === 'string' ? … : '关联失败' `` → `message.error(msg)` ｜ 建议口径：`` message.error(sanitizeUserText(detail, '关联失败：请稍后重试，或展开「技术详情」查看原始信息')) ``
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/tabs/ChaptersTab.tsx:206` ｜ 当前文案：`` for (const warning of parsed.warnings ?? []) message.warning(warning) `` ｜ 建议口径：`` message.warning(sanitizeUserText(warning, '这一步有需要注意的地方，已跳过')) ``
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/tabs/ChaptersTab.tsx:209` ｜ 当前文案：`` message.error(failureText(failure)) `` ｜ 建议口径：`` message.error(sanitizeUserText(failureText(failure), '分镜提取失败：请稍后重试')) ``（`failureText` = `${title}：${后端原文}`，见 `components/generationStatusCore.ts:328-330`）
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/tabs/ChaptersTab.tsx:341` ｜ 当前文案：`` message.error(describeEnvelopeError(error, '分镜提取失败')) ``（`describeEnvelopeError:56-73` 依次返回 `meta.error.message` → `message` → `detail` 原文）｜ 建议口径：`出口处统一过 maskInternalIds`
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/AssetImagePromptLlmPanel.tsx:573` → 渲染在 `:1266` ｜ 当前文案：`` error: error instanceof Error ? error.message : '生成失败' `` → `{row.error ? <span className="text-[11px] text-amber-600">{row.error}</span> : null}` ｜ 建议口径：`入 state 前 sanitizeUserText / maskInternalIds，主区列只说「这一项没生成成功」`
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/AssetImagePromptLlmPanel.tsx:630` ｜ 当前文案：`` message.error(`这条本机草稿在生成时就判为不可用：${restoredGuard.reason}；按原因改好正文即可保存。`) `` ｜ 建议口径：`reason 先脱敏 + 中文转述`
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/AssetImagePromptLlmPanel.tsx:691`（同款 `:811`）｜ 当前文案：`` message.error(failure.fix ? `${failure.message}（${failure.fix}）` : failure.message) `` ｜ 建议口径：`failure.message 来自 classifyGenerationFailure，属后端原文；先过 maskInternalIds`
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/AssetProductionArea.tsx:990`（同款 `:1117` → 渲染于 `AssetResultCard.tsx:167-173`）｜ 当前文案：`` errorMessage: failureText(failure) `` → `<Alert … message={<span className="text-[11px]">{task.errorMessage}</span>} />` ｜ 建议口径：`与同目录 assetProduction.ts:1132 describeFailureReason（已达标的正确范式）统一口径，failureText 输出先过 maskInternalIds`
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/AssetProductionArea.tsx:840`（同款 `:1785`）｜ 当前文案：`` message.error(error instanceof Error ? error.message : '查询任务失败') `` / `` … '生成提示词失败') `` ｜ 建议口径：`` message.error(sanitizeUserText((error as Error)?.message, '查询任务失败：请稍后重试')) ``
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/AssetProductionArea.tsx:1569`（同款 `:1633`）｜ 当前文案：`` message.error(failureText(failure)) `` ｜ 建议口径：`套 sanitizeUserText`
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/AssetProductionArea.tsx:1830` ｜ 当前文案：`` message.error(`这条提示词暂时不能保存：${verdict.reason}${verdict.fixes[0] ? `；怎么修：${verdict.fixes[0]}` : ''}`) `` ｜ 建议口径：`reason 归「质量原因」折叠层，主区只留「怎么修」那一句`
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/AssetProductionArea.tsx:1865` ｜ 当前文案：`` message.error(failure.fix ? `${failure.message}（${failure.fix}）` : failure.message) `` ｜ 建议口径：`failure.message 属后端原文，先 maskInternalIds`
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/AssetProductionArea.tsx:2361-2369` ｜ 当前文案：`` <Alert type="error" message={`有 ${progress.failed} 项生成失败…`} description={<ul>{progress.failureReasons.map((reason) => (<li key={reason}>{reason}</li>))}</ul>} /> ``（`failureReasons` ← `:955 reasons.push(task.errorMessage)` **未脱敏**）｜ 建议口径：`{maskInternalIds(reason)}`，或整块折进「失败明细（技术详情）」
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/AssetProfileEditEntry.tsx:67`（同款 `:114` → 渲染在 `:170`）｜ 当前文案：`` setError(String(e instanceof Error ? e.message : e)) `` → `{error ? <Alert type="error" showIcon message={error} /> : null}` ｜ 建议口径：`setError(sanitizeUserText(...))`
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/ProjectStudioStepPanel.tsx:96` → `:344`（同款 `:256`）｜ 当前文案：`` setDeliveryError((e as Error)?.message || '交付预览加载失败') `` → `<Alert … description={deliveryError} />` ｜ 建议口径：`` description={sanitizeUserText(deliveryError, '请稍后重试')} ``
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/assetProduction.ts:955` → `:1398` ｜ 当前文案：`` reasons.push(task.errorMessage) `` → `` detail: `本轮有 ${progress.failed} 项生成失败：${reason}（可以在对应结果卡片上单独重试）` `` ｜ 建议口径：`summarizeTaskProgress 收集时即脱敏；注意同文件 :1132 已脱敏、这里没有——同一文件两条失败路径口径不一致`
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/ProjectImagePrepPanel.tsx:214-221`（同款 `:233`）｜ 当前文案：`` const detail = error instanceof Error ? error.message : '该资产已有定版图，需要你确认后才能替换。' `` → `` content: <div className="text-xs">{detail}</div> `` ｜ 建议口径：`409 后端原文含 confirm_replace_primary；该文件无渲染入口，随 legacy 屏删除`

#### 基准禁词命中
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/ProjectExtractCandidatesPanel.tsx:699`（同款 `:700`）｜ 当前文案：`` {`候选 ${rows.length} 条`} `` / `` {`聚合 ${groups.length} 组`} `` ｜ 建议口径：`` {`待你确认的词条 ${rows.length} 条`} `` / **删掉「聚合 N 组」**
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/ProjectExtractCandidatesPanel.tsx:577`（同款 `:609`）｜ 当前文案：`{ title: '候选', … }` / `{ title: '候选状态', … }` ｜ 建议口径：`「从剧本里读出的词条」` / `「确认进度」`
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/ProjectExtractCandidatesPanel.tsx:602` ｜ 当前文案：`if (!item) return <Tag bordered={false}>检查中…</Tag>` ｜ 建议口径：`<Tag bordered={false}>正在核对…</Tag>`
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/ProjectExtractCandidatesPanel.tsx:711`（同款 `:697,775,782,787,845,849,873,893,959`）｜ 当前文案：`刷新候选` / `` {chapterLabel ?? '本集'} 还没有提取候选：点右上角「开始提取」… `` ｜ 建议口径：`「重新读取」` / `「…还没有可确认的词条：点右上角『开始提取』…」`
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/AssetImagePromptLlmPanel.tsx:1194`（同款 `:1200`）｜ 当前文案：`<Tag color="geekblue" bordered={false}>全局资产</Tag>` / `<Tag bordered={false} className="mr-0 text-gray-400">项目内资产</Tag>` ｜ 建议口径：`「所有项目共用」` / `「仅本项目」`
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/AssetImagePromptLlmPanel.tsx:1207`（同款 `:468`；文案源 `assetPromptSlots.ts:55,290,310`）｜ 当前文案：`` { title: '槽位', dataIndex: 'category', … } `` / `'后端这次没有返回这个类型的槽位（槽位表可能还在补）：可以手工填写后保存到资产。'` ｜ 建议口径：`「提示词位置」` / `「这一类暂时不能一键生成：先手工填写并保存」` ⚠️ 必须同步改 `assetPromptSlots.test.ts:117,210`
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/assetGenerationBasis.ts:69`（渲染于 `AssetGenerationBasisPanel.tsx:67`；同族 `AssetProductionArea.tsx:2282`、`AssetImagePromptLlmPanel.tsx:1013`）｜ 当前文案：`BASIS_PANEL_TITLE = '生成依据'` / `` `⑤ 最终提示词与差异（本页签 {n} 条）` `` ｜ 建议口径：`「这次用了哪些资料」` / `「本次真正会用的提示词与差异（N 条）」` ——「生成依据」「最终提示词」都在禁词表里，**折叠标题收起时也常显**
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/assetGenerationBasis.ts:970`（同款 `:156-161`、`:948`、`:78`、`:61`）｜ 当前文案：`` parts.push('最终提示词') `` / `'chapter_overlay+candidate_profile': '本章资产资料 + 候选结构化资料…'` / `'本章资产资料（后端未在本页登记这种来源码，代码见技术详情）'` / `'后端这次返回了生成依据字段，但每一项都是空的…'` / `requestStructure: '④ 图片提示词接口的脱敏请求结构'` ｜ 建议口径：`「本次采用的提示词」` / `「本章资产资料 + 结构化资料」` / 去掉「后端…」主语与「接口」字样
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/assetWriteScope.ts:66`（同款 `:73`、`:250`、`:261`）｜ 当前文案：`` statement: `${typeLabel}是**项目内资产**：它的资料与图片提示词只属于当前项目。` `` / `` `${typeLabel}是**全局资产**：通用资料在全局资产库里…` `` ｜ 建议口径：`` 「${typeLabel}只属于当前项目：改了不影响别的项目」 `` / `` 「${typeLabel}是全项目共用：改了所有项目都会看到」 ``，顺带去掉字面 `**`（现在会当星号显示）
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/assetWriteScope.ts:264`（同款 `:185`、`:179`）｜ 当前文案：`` lines.push(`本次会替换已有内容的槽位共 ${replaced} 个（旧内容不留副本）。`) `` / `` `替换 ${item.slot}：${item.before} → ${item.after}（旧的不会留副本）` `` ｜ 建议口径：`` `本次会替换 N 处已有内容（旧内容不留副本）` ``；`item.slot` 是 `character_image_front` 这类内部键，主区改「原有提示词 → 新提示词」
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/assetWriteScope.ts:276`（同款 `:201,198,273`）｜ 当前文案：`` okText: globalItems.length > 0 ? '确认写回（含全局资产）' : '确认保存' `` ｜ 建议口径：`「确认保存（含共用资产）」`
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/assetProduction.ts:1383` ｜ 当前文案：`` detail: '项目里还没有人物 / 场景 / 道具 / 服装资产：先在上面提取候选并确认写入，再回来准备图片。' `` ｜ 建议口径：`「先在上面把剧本里的角色/场景/道具/服装确认下来，再回来准备图片」`
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/extractConfirmPlan.ts:353` ｜ 当前文案：`` return `已确认 ${counts.total} 项资产（${parts.join('、')}），覆盖 ${counts.candidateCount} 条候选` `` ｜ 建议口径：`「已确认 N 项资产」`
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/userFacingStatus.ts:110`（同款 `:200`）｜ 当前文案：`label: '有候选等待确认'` / `` label: `有 ${input.pendingCandidateCount} 组候选等待确认` `` ｜ 建议口径：`「有待确认的内容」` / `` `有 N 项待你确认` `` —— 该 label 经 `describeUserStage` 渲染在 `ProjectExtractCandidatesPanel.tsx:655`
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/juriluScriptGroups.ts:161`（同款 `:144`、`:155`、`:219`、`:280`）｜ 当前文案：`` `后端未提供这些字段（${missing.join(' / ')}）：字段名清单见下方 raw_keys，不编造取值` `` / `` `分镜序号 ${range}（序号来自字段 ${seqField}）` `` / `factsTitle: '后端给出的客观事实'` / `'后端未返回 raw_keys（拿不到可用字段名清单）'` ｜ 建议口径：`「这一组缺少标题/时间信息，不影响选组」` / `「分镜序号 1–12」` / `「判断依据」`
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/juriluScriptGroups.ts:367`（同款 `:369`、`:240`、`:286`）｜ 当前文案：`` `后端只返回了 ${actual} 条分镜，但该组记录数是 ${expected} 条：可能有记录没解析出来或没进配对计划（本页不做截断，如实显示）。` `` / `` `…请核对是否混入了别的 scriptId。` `` / `'（接口一次返回的总条数不等于同一集的连续镜头。）'` ｜ 建议口径：`去掉「配对计划」「接口」「scriptId」等内部说法`

### 4.3 ChapterStudio（`pages/aiStudio/chapter/**`）

#### 模式 1
- [模式 1] `pages/aiStudio/chapter/components/useShotRequestPlan.ts:240` ｜ 当前文案：`` message.success(`已生成并挂到本镜（file_id=${fileId}）`) `` ｜ 建议口径：`` message.success('视频已生成并挂到本镜（内部 ID 见「技术详情」）') `` —— **本区域最典型的一处**，正是 `maskInternalIds` 设计来处理的场景，同文件却没用
- [模式 1] `pages/aiStudio/chapter/ChapterStudio.tsx:6861`（同款 `:6849`）｜ 当前文案：`` {shotLinkedAssetNameByFileId.get(fid) ?? fid} `` / `` title={shotLinkedAssetNameByFileId.get(fid) ?? fid} `` ｜ 建议口径：`` ?? '（未命名参考图）' ``
- [模式 1] `pages/aiStudio/chapter/ChapterStudio.tsx:5891` ｜ 当前文案：`已关联场景：{sceneNameMap[linkedSceneId] ?? linkedSceneId}` ｜ 建议口径：`?? '（场景名称读取失败）'`
- [模式 1] `pages/aiStudio/chapter/ChapterStudio.tsx:5843` ｜ 当前文案：`` const name = characterNameMap[cid] ?? cid ``（随后作 `title={name}`）｜ 建议口径：`?? '（角色名称读取失败）'`
- [模式 1] `pages/aiStudio/chapter/components/ShotBoundFilesPanel.tsx:124`（同款 `:143`）｜ 当前文案：`{row.asset_name || row.asset_id}` / `{audioRow.asset_name || audioRow.asset_id}` ｜ 建议口径：`{row.asset_name || '（资产名称读取失败）'}` / `{audioRow.asset_name || '（声音名称读取失败）'}`

#### 模式 2
- [模式 2] `pages/aiStudio/chapter/ChapterStudio.tsx:5159` ｜ 当前文案：`` message.success(`${frameLabel[frameType]}已上传并写入槽位`) `` ｜ 建议口径：`` message.success(`${frameLabel[frameType]}已上传并设为该帧（内部 ID 见「技术详情」）`) ``
- [模式 2] `pages/aiStudio/chapter/ChapterStudio.tsx:4526`（同款 `:4703`）｜ 当前文案：`'视频生成未返回产物：接口没有返回任务 ID，也没有返回视频地址'` / `message.error('生成任务创建失败：缺少任务 ID')` ｜ 建议口径：`「视频没有生成出来：服务没有返回成片，请重试」` / `「提示词生成没能启动，请重试」`
- [模式 2] `pages/aiStudio/chapter/components/ShotProductionWorkspace.tsx:153` ｜ 当前文案：`供应商、内部 ID、file_id / storage_key、接口参数与守卫状态（默认收起）` **【静态+运行时】** ｜ 建议口径：`「内部标识与调用参数（默认收起）」` —— **折叠区标题在收起状态即用户可见**，等于把第三层词表印在主区
- [模式 2] `pages/aiStudio/chapter/ChapterStudio.tsx:6964`（同族 `:519,526,540,546,6837,7254,7386,7532`）｜ 当前文案：`基础提示词生成依据` / `message.success('最终提示词已复制')` ｜ 建议口径：`「这条提示词是怎么来的」` / `「已复制提交版本」`
- [模式 2] `pages/aiStudio/chapter/ChapterStudio.tsx:6451,6477`（经 `maskInternalIds` 转换后）｜ 当前文案：运行时可见「该帧槽位没有 **文件编号**」「四类**槽位**的建议…推荐**接口**只读不写库」 **【静态+运行时】** ｜ 建议口径：`maskInternalIds 只把 file_id 换成了「文件编号」，**「槽位」「接口」两个禁词原样留下** → 建议把 FIELD_NAME_LABELS 扩成 masking 词表，`槽位→图片角度`、`接口→服务`、`推荐接口→推荐结果``

#### 模式 3
- [模式 3] `pages/aiStudio/chapter/components/ChapterStudioVideoReadinessPanel.tsx:54` ｜ 当前文案：`{check.ok ? '通过' : '未通过'} · {check.key}` **【静态+运行时】**（运行时为整排 `未通过 · extraction_ready`、`通过 · duration_ready / prompt_ready / reference_frames_ready / video_model_ready / provider_ready / no_active_video_task`）｜ 建议口径：`为 check.key 建中文映射（extraction_ready→「已提取分镜」、duration_ready→「时长已设置」、prompt_ready→「提示词已就绪」、reference_frames_ready→「参考帧齐全」、video_model_ready→「视频模型已配置」、provider_ready→「生成服务已就绪」、no_active_video_task→「没有正在跑的生成」），未登记项**隐藏整行**而不是回显原值`
- [模式 3] `pages/aiStudio/chapter/components/ChapterStudioVideoReadinessPanel.tsx:42` ｜ 当前文案：`当前按 <Tag className="!mx-1">{videoReferenceMode}</Tag> 参考模式检查视频生成条件。` **【静态+运行时】**（运行时见「当前按 `text_only` 参考模式检查」）｜ 建议口径：`{referenceModeLabel(videoReferenceMode)}` → 「纯文本（不用参考帧）」
- [模式 3] `pages/aiStudio/chapter/components/ChapterStudioReadinessDiagnosisPanel.tsx:102` ｜ 当前文案：`这里主要用于诊断当前镜头为什么仍然是 <span className="font-medium text-slate-700">pending</span>。` **【静态+运行时】** ｜ 建议口径：`「……为什么还在『待确认』状态。」`
- [模式 3] `pages/aiStudio/chapter/ChapterStudio.tsx:6269` ｜ 当前文案：`` {videoTaskStatus ? ` 任务状态：${videoTaskStatus}` : ''} `` ｜ 建议口径：`接后端状态 → 中文映射（排队中/生成中/已完成/失败/已取消），或整句移除`
- [模式 3] `pages/aiStudio/chapter/ChapterStudio.tsx:1500`（同款 `:5102`）｜ 当前文案：`` message.error(result.error || `生成未成功（status=${result.status || 'unknown'}）`) `` ｜ 建议口径：`「图片没能生成出来，请重试；若持续失败请到『技术详情』看原因」`
- [模式 3] `pages/aiStudio/chapter/ChapterStudio.tsx:3161`（同款 `useShotRequestPlan.ts:236`）｜ 当前文案：`` throw new Error(result.error || `视频生成未完成（status=${result.status}）`) `` ｜ 建议口径：`throw new Error(result.error || '视频没有生成出来，请重试')`
- [模式 3] `pages/aiStudio/chapter/ChapterStudio.tsx:6366` ｜ 当前文案：`` {savedPromptText.trim() ? `来源：${savedPromptSrc || '未标记'}` : '尚未保存'} `` ｜ 建议口径：`` `来源：${videoPromptSourceLabel(savedPromptSrc) || '未标记'}` `` —— 同文件 `:7465` 同一字段已用映射，此处漏用
- [模式 3] `pages/aiStudio/chapter/ChapterStudio.tsx:6536` ｜ 当前文案：`` <Tag color="gold">{`付费守卫：${requestPlan.plan.guard_status}`}</Tag> `` ｜ 建议口径：`` `是否允许真实付费：${guardLabel(requestPlan.plan.guard_status)}` `` —— 该 Tag 位于 `generate` 块（`STEP_OPEN_KEYS` 中 `deliver` 步**默认展开**）
- [模式 3] `pages/aiStudio/chapter/ChapterStudio.tsx:6559-6560` ｜ 当前文案：`<Descriptions.Item label="提示词来源">{requestPlan.plan.prompt_source || '—'}</Descriptions.Item>` ｜ 建议口径：`{videoPromptSourceLabel(requestPlan.plan.prompt_source) || '—'}`
- [模式 3] `pages/aiStudio/chapter/ChapterStudio.tsx:6799` ｜ 当前文案：`` <Tag>{`画幅 ${keyframePlanPreview.target_ratio}（${keyframePlanPreview.target_ratio_source}）`}</Tag> `` ｜ 建议口径：`` `画幅 ${…target_ratio}（${targetRatioSourceLabel(…)}）` `` → 「项目设置 / 镜头覆盖 / 本次指定」
- [模式 3] `pages/aiStudio/chapter/ChapterStudio.tsx:7513`（同族 `:7503`）｜ 当前文案：`` `直提端点守卫状态：${videoPinnedPlan.guardStatus}` `` / `` `固定模型：${videoPinnedPlan.modelName || '未知'}` `` ｜ 建议口径：`「是否允许真实付费：…」` / `` `模型方案：${videoModelBusinessName(videoPinnedPlan.modelName)}` ``
- [模式 3] `pages/aiStudio/chapter/ChapterStudio.tsx:227`（同款 `:236`）｜ 当前文案：`` return normalized || '未知来源' `` / `` return normalized || '未知' `` ｜ 建议口径：`return SOURCE_LABELS[normalized] ?? '未知来源'` / `return normalized ? '其他来源' : '未知'` —— **去掉回显后端原值**
- [模式 3] `pages/aiStudio/chapter/components/shotStatusText.ts:55` ｜ 当前文案：`` return FRAME_LABELS[key] ?? `${key} 帧` `` **【静态+运行时】**（运行时见「要求的帧：`first`」）｜ 建议口径：`` ?? '参考帧' `` —— 未登记帧类型会显示「mid 帧」这类原值
- [模式 3] `pages/aiStudio/chapter/components/useShotRequestPlan.ts:49`（同款 `:65`）｜ 当前文案：`` return REFERENCE_MODE_LABELS[key] ?? key `` / `` return VIDEO_MODEL_BUSINESS_NAMES[key] ?? key `` ｜ 建议口径：`?? '未识别参考方式'` / `?? '当前视频方案'`
- [模式 3] `pages/aiStudio/chapter/components/shotReadiness.ts:112` ｜ 当前文案：`` missing.push(`缺少参考帧：${absentFrames.join('、')}`) `` ｜ 建议口径：`` `${absentFrames.map(frameTypeLabel).join('、')}` ``（同目录 `shotStatusText.ts` 已有 `frameTypeLabel`，此处未复用）
- [模式 3] `pages/aiStudio/chapter/components/useShotRequestPlan.ts:191` ｜ 当前文案：`` text: `视频请求缺少参考方式「${referenceModeLabel(plan.reference_mode)}」要求的帧：${(plan.missing_frame_types ?? []).join('、')}…` `` ｜ 建议口径：`missing_frame_types 过 frameTypeLabel`
- [模式 3] `pages/aiStudio/chapter/components/VideoPromptLlmPanel.tsx:377` ｜ 当前文案：`` render: (value, row) => (value ? `${value.length} 字 / ${row.savedSource || '无来源'}` : '—') `` ｜ 建议口径：`` `${value.length} 字 / ${videoPromptSourceLabel(row.savedSource) || '无来源'}` ``（现状把 `jurilu` / `manual_workspace` 原样打进表格）

#### 模式 4
- [模式 4] `pages/aiStudio/chapter/ChapterStudio.tsx:7486` ｜ 当前文案：`` 「生成」走 <span className="font-mono">POST /api/v1/studio/image-pipeline/video-submit</span>： `` ｜ 建议口径：`「『生成』会在当前服务里直接跑完并等你看到结果：」`
- [模式 4] `pages/aiStudio/chapter/ChapterStudio.tsx:7491` ｜ 当前文案：`不再走 <span className="font-mono">POST /api/v1/film/tasks/video</span>：那条链路把任务丢给` ｜ 建议口径：`整段删除（属技术详情）`
- [模式 4] `pages/aiStudio/chapter/ChapterStudio.tsx:7492` ｜ 当前文案：`Celery 队列，本机没有 Redis / worker 时任务只会停在 pending（表现为"点了生成没反应"）。` ｜ 建议口径：`整段删除，或移入折叠层「历史实现说明」`
- [模式 4] `pages/aiStudio/chapter/ChapterStudio.tsx:7495` ｜ 当前文案：`固定策略 <span className="font-mono">seedance-2.0-mini · 480p · 最短 5s</span> 在直提端点强制生效；` ｜ 建议口径：`「本集统一用『短视频标准方案』（固定 480p、最短 5 秒）；」`
- [模式 4] `pages/aiStudio/chapter/ChapterStudio.tsx:7484`（同款 `:7524`）｜ 当前文案：`生成路径：直提（同进程内联执行）` / `DRY_RUN 守卫只作用于直提端点；既有任务链路不经过该守卫…` ｜ 建议口径：`「生成方式：立即执行，生成完自动挂到本镜」`，DRY_RUN 守卫说明移入折叠层
- [模式 4] `pages/aiStudio/chapter/ChapterStudio.tsx:3154` ｜ 当前文案：`'演练模式（DRY_RUN）：未真实生成、未产生费用。要真实生成请在后端显式关闭守卫（JELLYFISH_DRY_RUN=0 且 JELLYFISH_REAL_LLM_CONFIRMED=1）后重试。'` ｜ 建议口径：`「演练模式：本次没有真实生成、没有产生费用。如需真实生成，请联系管理员开启。」`
- [模式 4] `pages/aiStudio/chapter/ChapterStudio.tsx:1495`（同款 `useShotRequestPlan.ts:232`、`ChapterStudio.tsx:5090`）｜ 当前文案：`message.info('演练模式：未真实出图（DRY_RUN 开着）。')` ｜ 建议口径：`「演练模式：没有真实出图、没有产生费用。」`
- [模式 4] `pages/aiStudio/chapter/components/ShotAudioBindingSection.tsx:250-258` ｜ 当前文案：`` ②地址必须是「公网 http(s)」或 `asset://`（本地 `/files/...`、内网地址、… `` + 同段含 `SIX_STEP_ACCEPTANCE.md` 仓库文件名 **【静态+运行时】** ｜ 建议口径：`「②地址必须是公网可访问的地址，或已登记的素材引用」`；仓库文件名、`asset://`、`/files/...` 全部下沉技术详情

#### 模式 5
- [模式 5] `pages/aiStudio/chapter/ChapterStudio.tsx:6800` ｜ 当前文案：`` <Tag>{`${keyframePlanPreview.provider || '未识别供应商'} / ${keyframePlanPreview.model_name || '未识别模型'}`}</Tag> `` ｜ 建议口径：`` <Tag>{videoModelBusinessName(…)}</Tag> ``，原始 `provider` / `model_name` 移入折叠层
- [模式 5] `pages/aiStudio/chapter/ChapterStudio.tsx:7505` ｜ 当前文案：`` {videoPinnedPlan.provider ? <Tag>{`供应商：${videoPinnedPlan.provider}`}</Tag> : null} `` ｜ 建议口径：`从主区移除（「供应商」是禁词，prov-xxx 属第三层）`
- [模式 5] `pages/aiStudio/chapter/ChapterStudio.tsx:6445` ｜ 当前文案：`已存在但供应商取不到` ｜ 建议口径：`「已上传但当前服务取不到这张图」`
- [模式 5] `pages/aiStudio/chapter/components/shotStatusText.ts:121`（文案源）→ `shotReadiness.ts:114` ｜ 当前文案：`` label: `${blockedFrames.map(frameTypeLabel).join('、')}供应商取不到` `` / `` missing.push(`参考帧已上传但供应商无法访问：${blockedFrames.join('、')}`) `` ｜ 建议口径：`「…取不到」` / `「参考帧已上传但当前服务取不到：…」`
- [模式 5] `pages/aiStudio/chapter/components/useShotRequestPlan.ts:204-205` ｜ 当前文案：`'参考帧供应商无法访问：帧文件是本机/相对地址，只能解析成本机 data URL，' + '而当前供应商只接受公网地址。…'` ｜ 建议口径：`「参考图目前取不到：这张图只存在本机，上传到公网地址后再设为该帧，或改用纯文本模式。」`（该串经 `ChapterStudio.tsx:6544` 渲染在生成区 Alert）
- [模式 5] `pages/aiStudio/chapter/components/ShotAudioBindingSection.tsx:252` ｜ 当前文案：`` 看两点：①供应商支持参考音频（seedance 支持，字段 `audio_urls`；官方口径是 `` **【静态+运行时】** ｜ 建议口径：`「看两点：①生成服务要支持参考音频；②地址必须是公网地址或素材引用。」` ⚠️ `audioAdmissionCore.test.ts:39,59,134` 把「供应商」措辞冻结成断言，需同步改测试

#### 模式 6
- [模式 6] `pages/aiStudio/chapter/ChapterStudio.tsx` 内 `catch → message.error(err.message)` 一族（**20+ 处，归并一条**）｜ 代表性行号：`:3233`（`` `保存视频提示词失败：${err instanceof Error ? err.message : String(err)}` ``）、`:4465`、`:4906`、`:5105`、`:5223`、`:5161`、`:4853`；同类还有 `:1503,4421,4582,4680,4788,5679-5681` ｜ 建议口径：`统一 message.error(maskInternalIds(msg))，或原文收进技术详情、主区只给中文结论`
- [模式 6] `pages/aiStudio/chapter/ChapterStudio.tsx:4545`（同款 `:5086`）｜ 当前文案：`` message.error(failureText(failure)) `` / `` message.warning(notes[0], 6) ``（`notes = result.provider_notes`）｜ 建议口径：`failureText 的 reason 先过 maskInternalIds；:5086 是唯一一处把供应商解释原话铺到主区 toast 的地方，风险最高`
- [模式 6] `pages/aiStudio/chapter/components/useShotRequestPlan.ts:244`（同款 `:158`）｜ 当前文案：`` message.error(error instanceof Error ? error.message : '生成失败') `` ｜ 建议口径：`同上（这一条走 llmPipelineApi 的 callApi，后端原文 + HTTP xxx 会一起弹）`
- [模式 6] `pages/aiStudio/chapter/components/useShotRequestPlan.ts:202` → `:6544` / `:215` ｜ 当前文案：`` if (plan.generation_blocked) return plan.blocked_reason || '当前参考方式缺少必需帧，已阻止生成。' `` ｜ 建议口径：`` return maskInternalIds(plan.blocked_reason) || '…' ``（该串既进主区 Alert，也经 `:215` 进 toast）
- [模式 6] `pages/aiStudio/chapter/components/StudioStepProgressStrip.tsx:88` → `:204`（同款 `:191`）｜ 当前文案：`` setError((e as Error)?.message || '进度加载失败') `` → `<div className="mt-1 text-[11px] text-red-500">{error}</div>` / `` .catch((error) => message.error(error instanceof Error ? error.message : '导出失败')) `` ｜ 建议口径：`两处都加 maskInternalIds`
- [模式 6] `pages/aiStudio/chapter/components/ShotBoundFilesPanel.tsx:64` → `:93` ｜ 当前文案：`` setError(err instanceof Error ? err.message : '读取实际绑定文件失败') `` → `<Alert type="warning" showIcon message={error} />` ｜ 建议口径：`setError(maskInternalIds(...))` —— 同文件 `:131` **已经**调了 `maskInternalIds`，两条路径口径不一致
- [模式 6] `pages/aiStudio/chapter/components/VideoPromptLlmPanel.tsx:102` → `:308`（同款 `:386`）｜ 当前文案：`` setLoadError(error instanceof Error ? error.message : '读取本集镜头失败') `` → `<Alert type="warning" showIcon message={loadError} />` / `` placeholder={row.status === 'failed' ? row.error : '…'} `` ｜ 建议口径：`均加 maskInternalIds`
- [模式 6] `pages/aiStudio/chapter/ChapterStudio.tsx:6823`（同款 `:7519`）｜ 当前文案：`` {keyframePlanPreview.warnings.slice(0, 4).map((item, index) => (<li key={`plan-warning-${index}`}>{item}</li>))} `` / `` {videoPinnedPlan.warnings.map((item) => (<li key={item}>{item}</li>))} `` ｜ 建议口径：`{maskInternalIds(item)}` —— 同文件 `:6575` 同族渲染**已经**用了 mask，这两处漏用
- [模式 6] `pages/aiStudio/chapter/components/VideoPromptLlmPanel.tsx:410` ｜ 当前文案：`` {row.warnings.slice(0, 3).map((warning, index) => (<li key={`${row.shotId}-warn-${index}`}>{warning}</li>))} `` ｜ 建议口径：`{maskInternalIds(warning)}`
- [模式 6] `pages/aiStudio/chapter/components/shotReadiness.ts:117` ｜ 当前文案：`` for (const reason of input.frameBlockReasons ?? []) { if (reason) missing.push(reason) } `` ｜ 建议口径：`missing.push(maskInternalIds(reason))` —— 源头 `ChapterStudio.tsx:4936` 传的 `frame_block_reasons`，最终渲染在主区「本镜还缺什么」
- [模式 6] `pages/aiStudio/chapter/components/ChapterStudioVideoReadinessPanel.tsx:64`（同款 `:52`）｜ 当前文案：`• {check.message}` / Tooltip `title={check.message}` ｜ 建议口径：`maskInternalIds(check.message)`
- [模式 6] `pages/aiStudio/chapter/components/ChapterRawTextEditorModal.tsx:124`（同款 `:155,183`）｜ 当前文案：`` onFailed: (errorMessage) => { message.error(errorMessage) } ``（`errorMessage` 来自 `components/taskResultHelpers.ts:35` 的 `data.error`）｜ 建议口径：`message.error(maskInternalIds(errorMessage))`
- [模式 6] `pages/aiStudio/chapter/components/ChapterRawTextEditorModal.tsx:293`（同款 `:326,383,241`）｜ 当前文案：`` message.error(describeEnvelopeError(error, '智能精简失败')) ``（`describeEnvelopeError:55-73` 依次原样返回 `meta.error.message` → `message` → `detail` → `err.message`）｜ 建议口径：`出口处加 maskInternalIds`
- [模式 6] `pages/aiStudio/chapter/components/VideoPromptLlmPanel.tsx:336` ｜ 当前文案：`description="演练模式（DRY_RUN）下不会真的调用大模型，也不会花钱；要拿到可保存的结果需要先确认并关闭守卫。"` ｜ 建议口径：`「演练模式下不会真的调用大模型、不会花钱；需要正式结果请联系管理员开启真实调用。」`
- [模式 6] `pages/aiStudio/chapter/components/VideoPromptLlmPanel.tsx:405` ｜ 当前文案：`` {row.latencyMs ? <span …>{`${row.latencyMs} ms`}</span> : null} `` ｜ 建议口径：`移除或移入技术详情（调用耗时属技术层）`

#### 基准禁词命中
- [模式 2] `pages/aiStudio/chapter/components/shotStatusText.ts:99`（渲染于 `ChapterStudio.tsx:2348-2349`、`ShotProductionWorkspace.tsx:172`）｜ 当前文案：`label: '待确认资产候选'` ｜ 建议口径：`「待确认提取到的资产」`
- [模式 2] `pages/aiStudio/chapter/ChapterStudio.tsx:5624`（同款 `:5632,5637,3581,3778`）｜ 当前文案：`对白候选的主确认入口在分镜编辑页…` / `待确认对白候选` ｜ 建议口径：`统一改「待确认对白」`
- [模式 2] `pages/aiStudio/chapter/components/ChapterStudioReadinessDiagnosisPanel.tsx:135`（同款 `:165`）｜ 当前文案：`'无候选'` / `'当前分镜的剧本提取结果里还没有这类候选资产'` ｜ 建议口径：`「无需确认」` / `「…还没有提取到这类资产」`
- [模式 2] `pages/aiStudio/chapter/components/ChapterRawTextEditorModal.tsx:777-778`（同款 `:738,782`）｜ 当前文案：`` {it?.issue_type ? `[${it.issue_type}] ` : ''} `` + `Issue {idx + 1}` / `<Tag>issues：{consistencyIssues.length}</Tag>` / `候选角色：{it.character_candidates.join('、')}` ｜ 建议口径：`` 【${issueTypeLabel(it.issue_type)}】 `` + `第 {idx+1} 处问题` / `问题 N 处` / `相关角色：…`
- [模式 2] `pages/aiStudio/chapter/ChapterStudio.tsx:7054` ｜ 当前文案：`补充 Guidance` ｜ 建议口径：`「补充生成要求」`
- [模式 4] `pages/aiStudio/chapter/components/ShotAudioBindingSection.tsx:256` ｜ 当前文案：`` ②地址必须是「公网 http(s)」或 `asset://`（本地 `/files/...`、内网地址、…）`` ｜ 建议口径：`「②地址必须是公网可访问的地址，或已登记的素材引用」`（同 §4.3 模式 4 条目，此处按禁词视角登记）

#### 渲染缺陷（非 6 类，记录项）
- [渲染缺陷] `pages/aiStudio/chapter/components/ShotAudioBindingSection.tsx` 声音绑定长段落 ｜ 当前文案：`` `**输入**` 的 markdown 星号**字面显示**，未渲染成粗体 **【运行时】** ｜ 建议口径：`该段用 JSX 强标签替代 markdown 语法（`<strong>输入</strong>`），或引入统一的行内富文本渲染器`

#### 已判定合规（勿动）
- `ChapterStudio.tsx:6599-6655` 的 `technical` 块（供应商 / `model_name` / 各 `file_id` / `guard_status` / 后端原始提示）**默认收起**（`ShotProductionWorkspace.tsx:145-158` 渲染，`STEP_OPEN_KEYS` 不含 `technical`）→ 合规。因此 `:6611` `参考帧 file_id`、`:6614` `绑定素材 file_id`、`:6620`、`:6627`、`:6633`、`:6606` **不计入泄漏**
- `ChapterStudio.tsx:5731-5732,5745,5749` 的 provider / `provider_id` / `model_name` **位于 `part('kf_specs')`（`:6655`，在 `technical` 内）** → 合规
- `ChapterStudio.tsx:6392-6400` 的 `kf_cards`、`:6379-6383` 的 `camera/atmosphere` 为 antd `Collapse` 无 `defaultActiveKey` → 默认收起，合规
- `ShotProductionWorkspace.tsx:153` **除外**：折叠标题在收起态常显，已计入模式 2
- 未发现 6 类泄漏：`prep/usePrepFlow.ts`、`chapterIndexing.ts`、`ChapterStudioBatchToolbar.tsx`、`ChapterStudioMaintenancePanel.tsx`、`ExportScopeModal.tsx`
- `ChapterPrep.tsx` 有 **42 处 `（Mock）`** 用户可见文案（`:343,448,495,546,556,563,569,582,888-912,943-990` 等），如 `message.success('已生成角色图片（Mock）')`、`<Button>批量操作（Mock）</Button>`；它**当前不可达**（`App.tsx:36,40` 把 `prep/*` 与 `prep-drafts` 都重定向到 `../shots`）→ 建议直接删页而非翻译文案

### 4.4 任务中心与任务通知（`pages/aiStudio/components/task*`、`generation*`、`realRunMode*`）

#### 模式 1
- [模式 1] `pages/aiStudio/components/taskCopy.ts:208` ｜ 当前文案：`` return `${label}：${relationEntityId}` `` ｜ 建议口径：`只显示业务名；取不到就写「关联对象：名称读取中」，任何情况下不落实体 ID`
- [模式 1] `pages/aiStudio/components/taskCenterMeta.ts:63` ｜ 当前文案：`` `章节：${relationEntityId}` `` ｜ 建议口径：`「章节：名称读取中」`
- [模式 1] `pages/aiStudio/components/taskCenterMeta.ts:80`（同款 `:87`）｜ 当前文案：`` `镜头：${relationEntityId}` `` ｜ 建议口径：`「镜头：名称读取中」`
- [模式 1] `pages/aiStudio/components/taskCenterMeta.ts:122`（同款 `:162`）｜ 当前文案：`` `${labelPrefix}：${relationEntityId}` `` / `` `${labelPrefix}：${assetId}` `` ｜ 建议口径：`「演员：名称读取中」` 这类业务口径
- [模式 1] `pages/aiStudio/components/TaskCenter.tsx:414-415` ｜ 当前文案：`<div className="font-medium text-sm truncate">{task.title}</div>` / `{task.sourceLabel ? <div className="mt-1 text-xs text-gray-500 truncate">{task.sourceLabel}</div> : null}` ｜ 建议口径：`这是整条链路唯一渲染咽喉，两个字段都应过 maskInternalIds()（或改由上游只产出业务名）`
- [模式 1] `pages/aiStudio/layouts/../../layouts/MainLayout.tsx:99` ｜ 当前文案：`else label = segment` **【静态+运行时】**（运行时见 `/assets/scenes/{id}/edit` 面包屑含 percent-encoded ID 与英文段 `scenes`）｜ 建议口径：`面包屑兜底把 URL 段原样渲染（pathLabels:53-69 未登记 actors/roles/<uuid> 段）；应写「详情」或按路由补全 label，禁止回落 segment`

#### 模式 2
- [模式 2] `pages/aiStudio/components/realRunModeCore.ts:159-161` ｜ 当前文案：`` `第 3 步｜验证当前模式：执行 ${VERIFY_COMMAND}，确认 data.mode 为 "real"、data.guard.real_call_confirmed 为 true、data.switch_source 为 "env"/"dotenv"；` `` ｜ 建议口径：`分步说明保留在技术详情；主区只说「改完配置并重启后端，角标回到真实模式即为成功」`
- [模式 2] `pages/aiStudio/components/realRunModeCore.ts:173-174`（同款 `:181`）｜ 当前文案：`` confirm data.mode 为 "dry_run"、data.guard.dry_run 为 true；`` ｜ 建议口径：`「角标显示『演练模式』即为恢复成功」`

#### 模式 3
- [模式 3] `pages/aiStudio/components/GenerationGateBanner.tsx:62` ｜ 当前文案：`状态：{info.state}` ｜ 建议口径：`**本区域最直接的一处主区泄漏**。info.state 取 ready/dry_run/not_configured/unknown/missing_params/conflict/service_error/running/loading 会原样上屏（Alert 主行，非折叠层）。改中文映射：{ ready:'已就绪', dry_run:'演练门禁中', not_configured:'未配置', unknown:'状态待确认', missing_params:'参数不完整', conflict:'业务冲突', service_error:'服务异常', running:'处理中', loading:'读取中' }`
- [模式 3] `pages/aiStudio/components/taskCopy.ts:198` ｜ 当前文案：`` return TASK_KIND_TITLE_MAP[taskKind] ?? taskKind.split('_').join(' ') `` **【静态+运行时】**（运行时见任务类型标签英文原值 `video`，另两条是「图片生成」）｜ 建议口径：`后端已存在但映射表未覆盖的 kind 会真的上屏英文：script_merge→「script merge」、script_variant→「script variant」、video→「video」。兜底改「后台任务」并补映射（video→「视频生成」）`
- [模式 3] `pages/aiStudio/components/generationStatusCore.ts:161`（同款 `:162,169`）｜ 当前文案：`` label: `${outletLabel}已配置，当前被演练门禁（DRY_RUN）阻止` `` / `` `已就绪：${outletLabel} ${model.modelName}，未开启演练门禁` `` ｜ 建议口径：`「图片模型已配置，当前被演练门禁阻止」` / `「已就绪：图片模型已配置」`，DRY_RUN 与模型名下沉
- [模式 3] `pages/aiStudio/components/generationStatusCore.ts:305`（同款 `:324`、`realRunModeCore.ts:459`）｜ 当前文案：`title: '业务冲突（HTTP 409，不是演练门禁）'` / `` title: `请求失败（HTTP ${status}）` `` ｜ 建议口径：`「业务冲突，请检查是否重复提交（原始状态码见技术详情）」` / `「请求失败，请稍后重试」`
- [模式 3] `pages/aiStudio/components/realRunModeCore.ts:286` ｜ 当前文案：`actionLabel: AUDIT_LABELS[action] ?? action` ｜ 建议口径：`未映射 action（blocked / blocked_network / guard_installed）会当标签渲染（出口 RealRunModeBadge.tsx:267）；兜底改「拦截记录」`
- [模式 3] `pages/aiStudio/components/realRunModeCore.ts:249`（同款 `:264`）｜ 当前文案：`label: readString(record, 'label') || OUTLET_LABELS[outlet] || outlet` ｜ 建议口径：`兜底「未知出口」，不回显 llm/oss`
- [模式 3] `pages/aiStudio/components/generationStatusCore.ts:117`（同款 `:126`）｜ 当前文案：`label: '正在读取门禁与模型配置…'` / `label: '门禁与模型配置状态无法确认'` ｜ 建议口径：`「门禁」在 userFacingStatus.ts:21 的 FORBIDDEN_INTERNAL_TERMS 里；改「正在读取生成条件…」「生成条件状态暂时无法确认」`
- [模式 3] `pages/aiStudio/components/TaskCenter.tsx` 耗时文案 ｜ 当前文案：`耗时 206 小时 26 分／797 小时 16 分` 仍标「运行中」 **【运行时】** ｜ 建议口径：`非 6 类，但属误导：陈旧 `running` 任务应显示「状态未知（超过 N 小时未更新）」并给「标记为已失效」动作，而不是继续报「运行中」`

#### 模式 4
- [模式 4] `pages/aiStudio/components/generationStatusCore.ts:99-101` ｜ 当前文案：`` const openHint = `要真实调用，需显式设置 ${snapshot.guardEnv || FALLBACK_GUARD_ENV}=0 且 ${snapshot.confirmEnv || FALLBACK_CONFIRM_ENV}=1。` ``（即 `JELLYFISH_GUARD_DRY_RUN=0` / `JELLYFISH_CONFIRM_REAL=1`）｜ 建议口径：`环境变量说明整段下沉技术详情；主区只说「需要管理员开启真实调用」`
- [模式 4] `pages/aiStudio/components/realRunModeCore.ts:140` ｜ 当前文案：`const VERIFY_COMMAND = 'curl -s http://localhost:8000/api/v1/studio/llm/orchestration/status'` ｜ 建议口径：`本机地址 + 接口路径，经 RealRunModeBadge.tsx:78-80,237-241 渲染；整段收进技术详情`
- [模式 4] `pages/aiStudio/components/realRunModeCore.ts:139` ｜ 当前文案：`const START_COMMAND = 'cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000'` ｜ 建议口径：`同上`
- [模式 4] `pages/aiStudio/components/RealRunModeBadge.tsx:189` ｜ 当前文案：`` description={`${loadError}（端点：${orchestrationStatusUrl()}）在确认之前请按「当前不会真实调用」对待。`} `` ｜ 建议口径：`` `「无法读取后端运行模式，在确认之前按『不会真花钱』对待」` ``，URL 收进技术详情
- [模式 4] `pages/aiStudio/components/RealRunModeBadge.tsx:201` ｜ 当前文案：`守卫原文：{view.guardText || '（未提供）'}；开关：{view.env} / {view.confirmEnv}` ｜ 建议口径：`环境变量名整行进技术详情`
- [模式 4] `pages/aiStudio/components/RealRunModeBadge.tsx:209`（同款 `:283`）｜ 当前文案：`由 backend/.env 打开真实付费模式` / `说明文档：{view?.doc ?? 'docs/real-run-mode.md'}` ｜ 建议口径：`「由部署配置打开」` / 去掉仓库文件路径
- [模式 4] `pages/aiStudio/components/generationGate.ts:56` ｜ 当前文案：`` throw new Error(`GET ${path} 失败（HTTP ${response.status}）：${text.slice(0, 200)}`) `` ｜ 建议口径：`这句经 generationStatusCore.ts:127 的「读取状态失败：${snapshot.error}」直达主区，会把 `GET /api/v1/llm/model-settings 失败（HTTP 500）：<后端响应体 200 字>` 全量上屏；改中文结论 + 原文进技术详情`

#### 模式 5
- [模式 5] `pages/aiStudio/components/generationGate.ts:128` ｜ 当前文案：`` reason: `默认${label}（${readString(model, 'name') || modelId}）挂的供应商 ${providerId} 不在供应商表里。` `` ｜ 建议口径：`「默认图片模型的来源配置已失效，请到『模型管理』重新指定」`（同时命中禁词「供应商」+ 供应商 UUID + 模型 id）
- [模式 5] `pages/aiStudio/components/generationGate.ts:135-137` ｜ 当前文案：`` reason: `默认${label}（…）的供应商「${readString(provider, 'name') || providerId}」已停用。` `` ｜ 建议口径：`「默认图片模型的来源已停用，请到『模型管理』换一个」`
- [模式 5] `pages/aiStudio/components/generationGate.ts:118` ｜ 当前文案：`` reason: `默认${label} id=${modelId} 的类别是「${category}」，与该出口不匹配。` `` ｜ 建议口径：`「默认图片模型的类别与当前出口不匹配，请到『模型管理』重新指定」`（category 是 text/image/video 原值）
- [模式 5] `pages/aiStudio/components/generationGate.ts:111`（同款 `:100`、`:106`、`:141`）｜ 当前文案：`` reason: `默认${label} id=${modelId} 在模型表里查不到。` `` / `` `没有配置默认${label} id。` `` / `` `读不到模型表，无法确认默认${label}（id=${modelId}）是否真的存在。` `` ｜ 建议口径：`去掉 id=${modelId}，改「默认图片模型没有配置 / 配置已失效」`

#### 模式 6
- [模式 6] `pages/aiStudio/components/taskActionHelpers.ts:32`（同款 `:40,41`）｜ 当前文案：`` if (typeof error === 'string' && error.trim()) return error `` / `` if (typeof detail === 'string' && detail.trim()) return detail `` / `` if (typeof maybeAny.message === 'string' && maybeAny.message.trim()) return maybeAny.message `` ｜ 建议口径：`这是"后端原文 → 用户可见"的直通管道，裸字符串异常、body.detail、message 全部原样返回。应统一过 maskInternalIds + 中文兜底前缀。改这一处覆盖全仓多页调用点`
- [模式 6] `pages/aiStudio/components/taskActionHelpers.ts:86`（同款 `:93,117`）｜ 当前文案：`` message.error(res.message || emptyDataErrorMessage || fallbackErrorMessage) `` / `` message.error(getErrorMessage(error, fallbackErrorMessage)) `` ｜ 建议口径：`固定中文兜底 + 折叠原文。调用点示例：ChapterShotEditPage.tsx:856、AssetEditPageBase.tsx:686`
- [模式 6] `pages/aiStudio/components/taskResultHelpers.ts:35` ｜ 当前文案：`` const errorMessage = data.error || options.failedFallbackMessage `` ｜ 建议口径：`透传给 onFailed 前过 maskInternalIds`
- [模式 6] `pages/aiStudio/components/generationStatusCore.ts:127` ｜ 当前文案：`` description: `读取状态失败：${snapshot.error}` `` ｜ 建议口径：`「生成条件状态暂时读不到」+ 折叠原文`
- [模式 6] `pages/aiStudio/components/GenerationGateBanner.tsx:43` ｜ 当前文案：`` description: `真实原因：${resolvedFailure.reason}` ``（reason = sanitizeErrorMessage 后的后端原文）｜ 建议口径：`failureText 内部过 maskInternalIds，并按「中文标题 + 折叠依据」两层输出。落点见 ChapterStudio.tsx:4545、AssetEditPageBase.tsx:814、ChaptersTab.tsx:209、ProjectImagePrepPanel.tsx:233、EpisodeVideoPromptBoard.tsx:1318、AssetProductionArea.tsx:1569/:1633`
- [模式 6] `pages/aiStudio/components/RealRunModeBadge.tsx:64-65` ｜ 当前文案：`<Text strong>后端原文：</Text>` / `{details.message}` ｜ 建议口径：`明文标注的后端原文直渲（来源 realRunModeCore.ts:461,487）；保留原因、去掉「后端原文」这块`
- [模式 6] `pages/aiStudio/components/RealRunModeBadge.tsx:268` ｜ 当前文案：`{event.detail || event.target || '（无明细）'}` ｜ 建议口径：`测试夹具里即 'POST /api/v1/script-processing/divide 会真实调用大模型'、target: 'llm'；改用已中文的 event.reasonText`

#### 本区域合规对照（勿误判）
- `TaskCenter.tsx:107-115` 的 `taskTone()`：`pending/running/streaming/succeeded/failed/cancelled` 六个 `TaskStatus` **全部有中文标签**、末行兜底也是中文 → 无英文回显路径
- `TaskCenter.tsx` 其余文案全中文（`:260-263,352,371-375,390,394,419-422,445,457,519`）；`:407,:454` 的 `task.taskId` **只作 React key 与取消入参**，不上屏
- `taskUiStore.ts:164-171` 是**合规范本**：`message.success(data?.effective_immediately ? '任务已取消' : '已发送取消请求')` + `catch { message.error('取消任务失败') }` —— 故意丢弃后端原文
- `taskNotificationHelpers.tsx` 全文件干净：`notification.open` 的 message/description 全来自中文模板；`:160-165` 三态兜底均中文，**没有**把后端 detail 塞进 description
- `TaskRuntimeProvider.tsx`、`taskPageContext.ts` 无用户可见文案
- `realRunModeCore.ts:108-120,131-137,93-97` 四张中文映射表是**正面资产**；`:313` 明确用 `MODE_LABEL[mode]` 而非后端原值
- ⚠️ **反向锁死提醒**：`generationStatusCore.test.ts:52` 断言 description 必须含 `gpt-image-2`；`:141/:147/:152` 断言后端原文必须进 `failure.reason` —— 整改必然变红，需同步改口径

### 4.5 提示词看板 / 资产抽屉 / 待处理抽屉

#### 模式 1 / 2
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/workbench/workbenchState.ts:650`（被 `AssetDetailDrawer.tsx:34` 用作主区 Descriptions label）｜ 当前文案：`return PROFILE_FIELD_LABEL[String(key ?? '')] ?? String(key ?? '')` **【静态+运行时】**（运行时见资产详情抽屉「资产资料」行标签中英混杂 `relations` / `related_plot` / `shot_refs`）｜ 建议口径：`查不到中文标签时改「其它资料」，不回显原键`
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/workbench/workbenchState.ts:622-647` ｜ 当前文案：`PROFILE_FIELD_LABEL` 的键与 `assetProfileFields.ts:29-81`（后端唯一事实来源）**对不上** **【静态+运行时】** ｜ 建议口径：`以 ASSET_PROFILE_FIELD_SPECS 为唯一来源生成标签表，删掉手抄映射`。会整键回显英文的 14 个真实后端键：`relations` `costume_accessories` `related_plot` `shot_refs` `era_location` `indoor_outdoor` `spatial_structure` `furnishings` `light_tone` `atmosphere` `related_events` `usage` `identity_era` `accessories` ⚠️ `workbenchState.test.ts:391` 把「未知字段原样返回」钉成期望值
- [模式 1] `pages/aiStudio/project/ProjectWorkbench/components/EpisodeVideoPromptBoard.tsx:1410` ｜ 当前文案：`` if (!item.applied) failures.push(`${item.code || item.shot_id}：${item.reason}`) `` ｜ 建议口径：`` `有一镜未写入：${item.reason}` ``，回退成镜头编号原值属模式 1

#### 模式 3
- [模式 3] `pages/aiStudio/project/ProjectWorkbench/components/workbench/WorkbenchCommandBar.tsx:121` ｜ 当前文案：`{analysis?.status_label ? <Tag bordered={false}>{analysis.status_label}</Tag> : null}` ｜ 建议口径：`status_label 无枚举校验，后端回英文就直渲；应按 status 键映射中文（not_generated →「还没分析」）`
- [模式 3] `pages/aiStudio/project/ProjectWorkbench/components/assetResultKind.ts:146` ｜ 当前文案：`return server` ｜ 建议口径：`不认识的后端 label 退回 RESULT_LABEL_BY_ASSET_TYPE`
- [模式 3] `pages/aiStudio/project/ProjectWorkbench/components/promptBoardDrafts.ts:502` ｜ 当前文案：`return KNOWN_LABELS[key] ?? key` ｜ 建议口径：`未知来源统一「来源未标记」`
- [模式 3] `pages/aiStudio/project/ProjectWorkbench/components/assetPromptSlots.ts:236` ｜ 当前文案：`return ASSET_PROMPT_CATEGORY_LABEL[category] ?? category` ｜ 建议口径：`兜底改「图片提示词」`

#### 模式 4
- [模式 4] `pages/aiStudio/project/ProjectWorkbench/components/assetPromptSlots.ts:56` ｜ 当前文案：`ASSET_PROMPT_UNSUPPORTED_STATE_TEXT = '该资产类型没有大模型槽位'` ｜ 建议口径：`「这一类暂时不能用大模型生成提示词」`
- [模式 4] `pages/aiStudio/promptFlow/PromptFlowPage.tsx:~880-960` 高级选项区块 ｜ 当前文案：`高级选项（Authorization / Referer / API 覆盖 / 写入开关）` **【运行时】** ｜ 建议口径：`「高级选项（登录凭证 / 来源页 / 接口地址覆盖 / 是否写回）」`；相关 `:591` placeholder「粘贴整段 Cookie 字符串（应包含开头的 Authorization= 项）」、`:402` 错误文案需一并对齐

#### 模式 6
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/workbench/AssetCardGrid.tsx:158` ｜ 当前文案：`{reason ? <div className="text-[11px] text-red-500">{reason}</div> : null}`（`reason` ← `:91 String(item.status?.reason ?? '')`，契约 `assetWorkbenchContract.ts:249-250` 直接 `toText(raw.reason)`）｜ 建议口径：`先过 maskInternalIds + 中文状态句兜底（如「这一项暂时做不了：<原因>」），无原因时整行不显示`
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/workbench/AssetCardGrid.tsx:162` ｜ 当前文案：`{(item.prompt?.quality?.reasons ?? []).filter(Boolean).join('；') || '这条提示词不足以出图，建议重新生成后再生成图片。'}` ｜ 建议口径：`卡片正面只留「提示词需要重新生成」+ 按钮；后端 reasons 数组只进技术详情`
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/workbench/AssetDetailDrawer.tsx:63`（同款 `:135`）｜ 当前文案：`{item.status?.reason ? <span className="text-[11px] text-red-500">{item.status.reason}</span> : null}` / `` {`提示词需要重新生成：${(item.prompt.quality.reasons ?? []).filter(Boolean).join('；') || '这条提示词不足以出图'}`} `` ｜ 建议口径：`同上口径`
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/workbench/PendingReviewDrawer.tsx:64` ｜ 当前文案：`{row.reason || '需要你确认这一项该怎么处理。'}`（reason ← `assetWorkbenchContract.ts:280`）｜ 建议口径：`先过 maskInternalIds，缺原因保留现有兜底句`
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/workbench/WorkbenchCommandBar.tsx:173` ｜ 当前文案：`{analysis.hint}` ｜ 建议口径：`hint 属后端原文，主区只显示前端归纳的下一步动作`
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/workbench/workbenchState.ts:431`（同款 `:424`、`:196`）｜ 当前文案：`primaryDisabledReason: hint,` / `if (fromServer) return fromServer` ｜ 建议口径：`禁用原因用本文件自己的中文状态机词表；后端 status.label 需过白名单/枚举校验`
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/assetPromptQuality.ts:712`（同款 `:698`）｜ 当前文案：`` detail ? `后端标注：${detail}` : … `` / `` `${PROMPT_QUALITY_CODE_LABEL[code]}：后端判定这条提示词不能用于出图。` `` ｜ 建议口径：`去掉「后端标注 / 后端判定」前缀，改「这条提示词的外观信息还不够（原因见技术详情）」`
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/assetPromptRequestScope.ts:86` → `:158` ｜ 当前文案：`` const message = String(record.message ?? record.detail ?? '').trim() `` → `` const head = `${String(name ?? '').trim()}：${String(reason ?? '').trim()}` `` ｜ 建议口径：`渲染前统一过 maskInternalIds`
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/promptBoardDrafts.ts:406`（同款 `:485`）｜ 当前文案：`` return detail ? `${label} 正在生成中，已跳过｜${detail}` : … `` / `` `服务端草稿：共 ${total} 镜 · ${parts.join(' · ')}` `` ｜ 建议口径：`「这 N 镜正在生成，已跳过」+ 中文原因；「服务端草稿」改「上次生成到」`
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/promptBoardSaveBody.ts:113`（同款 `:120,123`）｜ 当前文案：`'巨日禄分镜没有可用的脚本组（matchedScriptId 为空）：默认不跨 scriptId 合并，本次不发保存请求。'` / `` `第 ${position} 条没有脚本组（script_id 为空）：无法证明它属于脚本组 ${scriptId}，本次不发保存请求。` `` ｜ 建议口径：`「还没有匹配到脚本组：为避免把不同脚本组的镜头混在一起，本次没有保存」`
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/EpisodeVideoPromptBoard.tsx:450`（同款 `:469,472,959,1429,1468,273,647`）｜ 当前文案：`` message.warning(`读取服务端草稿状态失败：${error instanceof Error ? error.message : '未知原因'}`, 6) `` / `` message.error(error instanceof Error ? error.message : '读取本集镜头失败') `` / `` message.error(`镜头 ${code} 申请生成租约失败：${text}`) `` ｜ 建议口径：`统一 message.error(sanitizeUserText(...))；「生成租约」是开发术语，改「这一镜暂时排不上，请稍后重试」`
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/EpisodeVideoPromptBoard.tsx:1412`（同款 `:1420`）｜ 当前文案：`` if (result.error) failures.push(result.error) `` → `` message.warning(`有 ${failures.length} 条未写入：${failures.slice(0, 3).join('；')}`, 8) `` ｜ 建议口径：`push 前过 sanitizeUserText / maskInternalIds`
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/EpisodeVideoPromptBoard.tsx:1416` ｜ 当前文案：`` `已保存 ${applied} 条到镜头（正式提示词${matchedScriptId ? `，来源 jurilu，脚本组 ${matchedScriptId}` : ''}）…` `` ｜ 建议口径：`` `已保存 ${applied} 条到镜头（来源：巨日禄导入）` ``，组编号与 `jurilu` 原名移入技术详情
- [模式 6] `pages/aiStudio/project/ProjectWorkbench/components/EpisodeVideoPromptBoard.tsx:1073,1216` ｜ 当前文案：`` message.error(`${text}｜${diag}`, 8) ``（`text` = `error.message`，`diag` = `extractJuriluDiagnostics` 脱敏诊断）｜ 建议口径：`「后端原文 + 脱敏诊断」整串进 toast 是模式 3/4/6 的合集落点；主区给「凭证可能已失效，请重新获取」，诊断进技术详情`

#### 基准禁词命中
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/assetPromptQuality.ts:56` ｜ 当前文案：`unknown: '提示词质量未知',`（禁词逐字命中）→ 经 `:647 label` 由 `PromptQualityAlert.tsx:60 {verdict.label}` 渲染，落到 `AssetProductionArea.tsx:1980`、`AssetImagePromptLlmPanel.tsx:1265` ｜ 建议口径：`'还没有检查这一条'`
- [模式 2] `pages/aiStudio/project/ProjectWorkbench/components/workbench/workbenchState.ts:69`（同款 `:967-973`）｜ 当前文案：`` if (isBasisItemProvided(basis, 'scopedBasis')) parts.push(`本章依据 ${basis.scopedBasis.length} 条`) `` ｜ 建议口径：`「本章资料 N 条」`

#### 本区域合规对照（勿误判）
- `workbench/ScriptTextPanel.tsx`：只有剧本正文/集名/分镜序号，全中文
- `workbench/TechnicalDetailCollapse.tsx` + `technicalView.ts`：第三层的**唯一**合规落点，默认 `details` 收起
- `workbench/taskProgress.ts`：只转发并过滤 `describeProgressLines` 的中文标签
- `workbench/assetWorkbenchApi.ts`、`promptPanelAssets.ts`、`assetPromptDrafts.ts`、`assetWorkbenchContract.ts`：读字段但不渲染（`asset_id` 仅作 key/映射）
- `components/localSnapshotStore.ts`、`assetRoundStore.ts`：`RESTORED_UNFINISHED_NOTE` 全中文
- `components/assetProfileFields.ts`：label/placeholder 全中文；问题在消费方 `workbenchState.PROFILE_FIELD_LABEL` 与 spec 键不同步
- ⚠️ `assetPromptSlots.test.ts:117,210` **反向锁定**「不支持（无槽位）」「后端槽位表里还没有」，改文案必须同步改测试

### 4.6 实体管理（`assets/**`）+ 镜头 / 编辑器 / 文件 / 模板 / 编排 / Agent

#### 模式 1
- [模式 1] `pages/aiStudio/assets/components/AssetEditPageBase.tsx:1505` ｜ 当前文案：`{asset?.id ? <Tag>{asset.id}</Tag> : null}` ｜ 建议口径：`删掉，或收进技术详情`
- [模式 1] `pages/aiStudio/assets/components/AssetEditPageBase.tsx:1689` ｜ 当前文案：`<Tag color="blue">ID {slot.image.id}</Tag>` **【静态+运行时】**（运行时见场景编辑页「照片角度：正面 **ID 23**」）｜ 建议口径：`<Tag>已出图</Tag>（数字 ID 移入「技术详情」）`
- [模式 1] `pages/aiStudio/assets/components/AssetEditPageBase.tsx:1791` ｜ 当前文案：`` `图片 ${candidate.id}` `` ｜ 建议口径：`` `历史生成图（第 N 张）` ``
- [模式 1] `pages/aiStudio/assets/components/AssetEditPageBase.tsx:2218` ｜ 当前文案：`<span className="ml-3">项目：{referenceBatchResult.project_id}</span>` ｜ 建议口径：`项目：<项目名称>`
- [模式 1] `pages/aiStudio/assets/components/AssetEditPageBase.tsx:1636,1638` ｜ 当前文案：`` {assetNavigateRelationType ? `资产类型：${assetNavigateRelationType}` : '资产类型：未知'} `` / `` {resolvedProjectId ? `项目作用域：${resolvedProjectId}` : '项目作用域：未识别'} `` **【静态+运行时】**（运行时见「资产类型：`scene` 项目作用域：未识别」）｜ 建议口径：`资产类型走中文映射（scene→场景）；项目作用域显示项目名而不是 UUID`
- [模式 1] 资产标题（数据侧，运行时于 `/assets/scenes/{id}/edit` 首屏）｜ 当前文案：标题 `SCENE_星耀疗养院S级特护病房门外`（`SCENE_` 前缀 + 内部命名）**【运行时】** ｜ 建议口径：`数据侧改名优先；前端在展示层剥离 `SCENE_` / `PROP_` / `CHAR_` 这类前缀，并在技术详情里保留原名`
- [模式 1] `pages/aiStudio/assets/components/AssetEditPageBase.tsx:2308`（同款 `:2316`）｜ 当前文案：`<span className="font-mono">{row.service_task_id || '（空）'}</span>` / `<span className="text-xs text-gray-400">{row.source_asset_id}</span>` ｜ 建议口径：`主区只给「已提交，正在生成」；任务号与来源资产 UUID 移入技术详情`
- [模式 1] `pages/aiStudio/promptFlow/PromptFlowPage.tsx:313`（同款 `:317`）｜ 当前文案：`const options = items.map((c) => ({ label: c.title || c.id, value: c.id }))` ｜ 建议口径：`章节没标题时显示「第 N 章」，不要回退成 UUID`
- [模式 1] `pages/aiStudio/promptFlow/PromptFlowPage.tsx:1488` ｜ 当前文案：`` title: selectedSkill ? `${selectedSkill.display_name}（${selectedSkill.skill_id}）` : skillId `` ｜ 建议口径：`只保留 display_name`
- [模式 1] `pages/aiStudio/llmPipeline/LlmPipelinePage.tsx:894`（同款 `:963`、`:964`、`:1215`、`:682`、`:670`）｜ 当前文案：`{ title: '幂等键', dataIndex: 'source_task_id', ellipsis: true }` / `{ title: 'service_task_id', dataIndex: 'service_task_id', width: 180 }` / `<Descriptions.Item label="provider_task_id">{…}</Descriptions.Item>` / `` title={`[${String(shot.index)}] ${String(shot.shot_id)} · ${String(shot.title ?? '')}`} `` ｜ 建议口径：`整列/整行移入默认收起的「技术详情」；资产列改显示资产名`

#### 模式 2
- [模式 2] `pages/aiStudio/assets/assetAdapters.ts:26`（同款 `:61,96,132,168`）｜ 当前文案：`missingAssetIdText: '缺少 character_id'` ｜ 建议口径：`'地址里没有资产编号，请从项目工作台第 2 步「资产准备」进入'`
- [模式 2] `pages/aiStudio/assets/components/AssetEditPageBase.tsx:2272` ｜ 当前文案：`description="下面的 service_task_id 是占位值，oss_url 为空（DRY_RUN 不会调用出图服务、也不会上传 OSS）。"` ｜ 建议口径：`'本次是演练，没有真正提交出图，因此不产生真实图片地址。'`
- [模式 2] `pages/aiStudio/assets/components/AssetEditPageBase.tsx:2307`（同款 `:2319`）｜ 当前文案：`service_task_id：` / `oss_url：` ｜ 建议口径：`'提交编号：'（移入技术详情）/ '图片长期地址：'（为空时说「未生成长期地址」）`
- [模式 2] `pages/aiStudio/assets/components/AssetEditPageBase.tsx:2184` ｜ 当前文案：`description="接口只返回了失败状态，没有附带 message / detail.error_message；可让后端补充错误详情，或直接查出图服务日志。"` ｜ 建议口径：`'服务端没有给出失败原因，可稍后重试；若持续失败请联系管理员。'`（**这句把后端字段名、实现建议和"去查日志"都给了终端用户**）
- [模式 2] `pages/aiStudio/assets/components/AssetEditPageBase.tsx:2042`（同款 `:2072`、`:792`）｜ 当前文案：`<span className="text-xs text-gray-500">{slot.category}</span>` / `<span className="text-gray-400">{layerKey}：</span>` / `` `出图没有返回可用图片地址（后端返回状态：${submitted?.status || '未提供'}）` `` ｜ 建议口径：`只显示中文类别标签；分层结构整块移入折叠层；括号内状态码去掉`
- [模式 2] `pages/aiStudio/llmPipeline/LlmPipelinePage.tsx:303`（同款 `:310,420,422,514,866`）｜ 当前文案：`<Card size="small" title="输入（chapter_id 与原文至少给一个）">` / `<Card size="small" title="输入（shot_id 与镜头文本至少给一个）">` / `<Form.Item name="asset_ids" label="指定资产 ID（逗号分隔，留空=项目内全部该类型资产）">` ｜ 建议口径：`「章节与原文至少填一个」` / `「镜头编号与镜头文本至少填一个」` / `「指定资产（留空 = 本项目该类型下的全部资产）」`
- [模式 2] `pages/aiStudio/llmPipeline/LlmPipelinePage.tsx:311`（同款 `:575`）｜ 当前文案：`<Input placeholder="例如 script_xxx_EP01" allowClear />` / `<Card size="small" title="完整结构（对齐 shot_video_prompt_pack）">` ｜ 建议口径：`「例如：本剧第一集」` / `「完整结构」`
- [模式 2] `pages/aiStudio/shots/components/ShotAudioBindingSection.tsx:362`（同款 `:382`）｜ 当前文案：`` 素材库里目前没有音频文件（`files.type=audio`）。`` / `<Tag color="blue">type=audio</Tag>` ｜ 建议口径：`「素材库里还没有音频素材。」` / 删掉该 Tag
- [模式 2] `pages/aiStudio/shots/components/ChapterShotAssetBindingSection.tsx:457` ｜ 当前文案：`` {`llm_called=${String(meta.llm_called)}；目标模型=${meta.target?.model_name ?? '未解析'}`} `` ｜ 建议口径：`'本次为演练占位结果，没有真正调用模型。'`
- [模式 2] `pages/aiStudio/assets/components/AssetEditPageBase.tsx` 场景描述字段渲染（`AssetTypeTab.tsx:262` / `ActorsTab.tsx:175` / `AssetEditPageBase.tsx:1651`）｜ 当前文案：`已根据该资产出现的 `segments、shots、台词、visual_focus、continuity_note 和 story_function` 生成` **【运行时】** ｜ 建议口径：`这是**后端生成的 description 原样上屏**；前端应改为「已根据该资产在本集剧本里的出场、台词与作用生成」，英文字段名不进主区（或整段折进技术详情）`

#### 模式 3
- [模式 3] `pages/aiStudio/shots/ChapterShotsPage.tsx:86` ｜ 当前文案：`return <Tag color={color}>{status}</Tag>` ｜ 建议口径：`映射中文（pending→待确认、generating→生成中、ready→已就绪）`
- [模式 3] `pages/aiStudio/assets/components/AssetEditPageBase.tsx:2311-2312` ｜ 当前文案：`status：` / `<Tag color={ASSET_OUTCOME_TAG_COLOR[normalized.outcome]}>{normalized.rawStatus || '未知'}</Tag>` ｜ 建议口径：`同文件已导入 ASSET_OUTCOME_LABEL，改用中文口径`
- [模式 3] `pages/aiStudio/assets/components/AssetEditPageBase.tsx:2156` ｜ 当前文案：`` `${singleGenSummary.title}｜后端状态：${singleGenResult.status}` `` ｜ 建议口径：`只保留中文结论，去掉「后端状态：succeeded/partial_failed」`
- [模式 3] `pages/aiStudio/llmPipeline/LlmPipelinePage.tsx:976`（同款 `:1209`、`:921`）｜ 当前文案：`{normalized.rawStatus || '未知'}` / `{submitResult.guard_status ? <Tag>{String(submitResult.guard_status)}</Tag> : null}` ｜ 建议口径：`改用 ASSET_OUTCOME_LABEL / 「真实调用」·「演练模式」`
- [模式 3] `pages/aiStudio/llmPipeline/LlmPipelinePage.tsx:565`（同款 `:562`、`:688,696`、`:893`、`:336,338`）｜ 当前文案：`<Descriptions.Item label="帧模式">{String(result.frame_mode)}</Descriptions.Item>` / `{String((result.camera_movement as AnyRecord)?.enum_code ?? '无对应枚举')}）` / `<Tag color={v === 'auto' ? 'green' : …}>{v}</Tag>` / `{ title: 'generation_type', dataIndex: 'generation_type', width: 140 }` / `<Tag>dry_run：{dryRunText(...)}</Tag>` ｜ 建议口径：`single_frame→'单帧'、first_last_frame→'首尾帧'；删枚举码只留 label；auto→预选、review→需复核、discard→已丢弃；dry_run→'演练模式：是/否'`
- [模式 3] `pages/aiStudio/prompts/PromptTemplateManager.tsx:404` ｜ 当前文案：`<Tag>{categoryLabels[selected.category] || selected.category}</Tag>` ｜ 建议口径：`兜底改「未分类」`
- [模式 3] `pages/aiStudio/agents/AgentManagement.tsx:240` ｜ 当前文案：`<Tag color={typeColorMap[type] ?? 'default'}>{typeLabelMap[type] ?? type}</Tag>` ｜ 建议口径：`兜底改「其他」`
- [模式 3] `pages/aiStudio/agents/AgentEdit.tsx:183` ｜ 当前文案：`<span className="ml-2 text-xs text-gray-400">({node.type})</span>` ｜ 建议口径：`（节点类型）或去掉；node.type 是英文节点类型码`

#### 模式 4
- [模式 4] `pages/aiStudio/assets/utils.ts:36` ｜ 当前文案：`'http://localhost:8000'` 作为 `resolveAssetUrl` 兜底 base ｜ 建议口径：`兜底保留（不渲染就不算泄漏），但 resolveAssetUrl 的输出直接进 src/href；建议在内部同时返回 isPrivate 标记，页面据此显示「长期地址未就绪」`
- [模式 4] `pages/aiStudio/assets/components/AssetEditPageBase.tsx:684` ｜ 当前文案：`` message.error('接口未找到：请运行 `pnpm run openapi:update` 生成客户端代码后重试') `` ｜ 建议口径：`'页面与服务端版本不一致，请刷新页面；仍不行请联系管理员。'`（**把开发命令给了终端用户**）
- [模式 4] `pages/aiStudio/assets/components/AssetEditPageBase.tsx:2321-2322` ｜ 当前文案：`<a href={row.oss_url} target="_blank" rel="noreferrer">{row.oss_url}</a>`（同款 `:2197` `break-all` 直渲 `singleGenResult?.url`）｜ 建议口径：`图片已在上方显示，原始地址移入技术详情`
- [模式 4] `pages/aiStudio/shots/ChapterShotEditPage.tsx:1056`（同款 `:1113`）｜ 当前文案：`message.error('existence-check 返回为空')` / `message.error('existence-check 调用失败')` ｜ 建议口径：`'没有查到该资产是否已存在，请重试'` / `'查询资产失败，请重试'`
- [模式 4] `pages/aiStudio/llmPipeline/LlmPipelinePage.tsx:1000`（同款 `:999-1008`）｜ 当前文案：`title: 'OSS 地址',` + `<a href={v} target="_blank" rel="noreferrer">{v}</a>` ｜ 建议口径：`'图片长期地址'；列内只显示「查看图片」链接，原始 OSS object 地址移入技术详情`
- [模式 4] `pages/aiStudio/promptFlow/PromptFlowPage.tsx:575` ｜ 当前文案：`placeholder="https://.../agent?projectId=xxx&clipId=yyy"` ｜ 建议口径：`'例如：https://…/agent'（不要在用户可见处暴露参数名）`
- [模式 4] `pages/aiStudio/promptFlow/PromptFlowPage.tsx:979`（同款 `:1510`）｜ 当前文案：`` throw new Error(renderEnvelope(parsed, text || `下载失败（HTTP ${response.status}）`)) `` ｜ 建议口径：`「下载失败，请稍后重试」；renderEnvelope（:89-102）会把 meta.diagnostics 展开成 `k: JSON.stringify(v)` 并原样吐出 meta.warnings / detail`
- [模式 4] `pages/aiStudio/promptFlow/PromptFlowPage.tsx:197`（同写法全页 **20 处**：`:363,391,441,462,882,913,948,995,1238,1266,1298,1389,1412,1456,1459,1526,1567`）｜ 当前文案：`` message.error(`加载项目失败：${describeError(error)}`) `` ｜ 建议口径：`先脱敏或只保留 message 一句中文`

#### 模式 5
- [模式 5] `pages/aiStudio/llmPipeline/LlmPipelinePage.tsx:1105` ｜ 当前文案：`message="固定策略：出视频只用 seedance-2.0-mini + 480p，提交前会强制写回这几个参数"` ｜ 建议口径：`'出视频固定用轻量方案（5 秒 / 480p），提交时会强制写回这几个参数。'`
- [模式 5] `pages/aiStudio/llmPipeline/LlmPipelinePage.tsx:853`（同款 `:855`）｜ 当前文案：`{ label: 'image2（→ gpt-image-2）', value: 'image2' }` / `{ label: 'Nano Banana 2', value: 'nano-banana-2-ext' }` ｜ 建议口径：`'标准图片方案（质量均衡）'` / `'高清图片方案'`
- [模式 5] `pages/aiStudio/llmPipeline/LlmPipelinePage.tsx:1159`（同款 `:1161`、`:339`、`:567`）｜ 当前文案：`<Descriptions.Item label="provider">{String(plan.provider)}</Descriptions.Item>` / `<Tag>模型：{String((…target as AnyRecord)?.model_name ?? '—')}</Tag>` ｜ 建议口径：`删掉或改名「生成服务」并移入技术详情`
- [模式 5] `pages/aiStudio/promptFlow/PromptFlowPage.tsx:1445`（同款 `:1454`、`:1690`）｜ 当前文案：`` `生成完成（模型：${data?.model_used || '默认文字模型'}）…` `` ｜ 建议口径：`'生成完成'`
- [模式 5] `pages/aiStudio/shots/components/ShotAudioBindingSection.tsx:252`（同款 `:258`、`:321`；`ChapterShotAssetBindingSection.tsx:385`；`LlmPipelinePage.tsx:866`）｜ 当前文案：`` 看两点：①供应商支持参考音频（seedance 支持，字段 `audio_urls`；官方口径是 `` / `「已绑定，但供应商无法访问」…` ｜ 建议口径：`'看两点：①生成服务要支持参考音频；②地址必须是公网地址或素材引用。'` ⚠️ `audioAdmissionCore.test.ts:39,59,134` 把「供应商」冻结成断言

#### 模式 6
- [模式 6] `pages/aiStudio/assets/components/AssetEditPageBase.tsx:814` ｜ 当前文案：`message.error(failureText(failure))` ｜ 建议口径：`message.error(sanitizeUserText(failureText(failure)))`
- [模式 6] `pages/aiStudio/assets/components/AssetEditPageBase.tsx:686`（同款 `:893,1025,1172,1208,1237,1407`）｜ 当前文案：`message.error(defaultTaskActionErrorMessage(error, '智能检测失败'))` / `message.error(error instanceof Error ? error.message : '采纳失败')` ｜ 建议口径：`统一 message.error(maskInternalIds(...) || '…')`
- [模式 6] `pages/aiStudio/assets/components/AssetEditPageBase.tsx:791`（同款 `:1986`、`:1998`、`:2085`）｜ 当前文案：`submitted?.message || …` / `` ? `拦截原因：${imagePromptDryRunReason}` `` / `{warning}`（`imagePromptWarnings.map`）｜ 建议口径：`后端 message / warnings 先脱敏；「拦截原因」改「演示模式已开启，提示词只是占位内容」`
- [模式 6] `pages/aiStudio/assets/components/AssetEditPageBase.tsx:457` ｜ 当前文案：`` onFailed: (errorMessage) => { message.error(errorMessage) } ``（智能检测任务结果 `data.error`）｜ 建议口径：`先过 maskInternalIds`
- [模式 6] `pages/aiStudio/shots/ChapterShotsPage.tsx:60-79` → `:330` ｜ 当前文案：`` message.error(getErrorMessage(error)) ``（getErrorMessage 依次返回 `body.detail` / `body.message` / `meta.error.message` 原文）｜ 建议口径：`在出口处统一脱敏`
- [模式 6] `pages/aiStudio/shots/ChapterShotEditPage.tsx:856`（同款 `:912`）｜ 当前文案：`message.error(defaultTaskActionErrorMessage(error, '提取失败'))` ｜ 建议口径：`同上`
- [模式 6] `pages/aiStudio/shots/components/ChapterShotAssetBindingSection.tsx:186` → 渲染于 `:428-440` ｜ 当前文案：`` setPreviewError(defaultTaskActionErrorMessage(error, 'AI 推荐资产关联失败')) `` → `` <Alert type="error" message="推荐失败" description={<div>{previewError}</div> … `` ｜ 建议口径：`写入 state 前先脱敏`
- [模式 6] `pages/aiStudio/shots/components/ChapterShotAssetBindingSection.tsx:356-363` ｜ 当前文案：`` { title: '理由', dataIndex: 'reason', render: (reason) => ( … {reason?.trim() ? <div className="text-[11px] text-slate-400">{reason}</div> : null} ) } ``（reason ← `:267 defaultTaskActionErrorMessage(error, '保存失败')`）｜ 建议口径：`写 state 时即脱敏；列名「理由」改「建议依据」`
- [模式 6] `pages/aiStudio/shots/components/ChapterShotAssetBindingSection.tsx:464-476` ｜ 当前文案：`` <Alert type="info" message="后端提示" description={<ul>{warningList.map((item) => (<li key={item}>{item}</li>))}</ul>} /> `` ｜ 建议口径：`标题「后端提示」本身就是模式 2，改「需要注意的地方」；列表项过 maskInternalIds`
- [模式 6] `pages/aiStudio/shots/components/ChapterShotAssetBindingSection.tsx:481-489` ｜ 当前文案：`` <li key={`${item.label}-${item.reason}`}>{`${item.label}：${item.reason}`}</li> `` ｜ 建议口径：`item.reason 先脱敏`
- [模式 6] `pages/aiStudio/shots/components/ShotAudioBindingSection.tsx:148`（同款 `:165,200,295`）｜ 当前文案：`message.error((e as Error)?.message || '保存声音绑定失败')` / `{error ? <Alert type="error" showIcon message="音频素材加载失败" description={error} /> : null}` ｜ 建议口径：`两侧都先脱敏`
- [模式 6] `pages/aiStudio/shots/components/ChapterShotAssetBindingSection.tsx:444-461` ｜ 当前文案：`` <Alert type="warning" message="当前处于 DRY_RUN 守卫状态：本次没有真实调用大模型" description={ … {meta.dry_run_reason || 'JELLYFISH_DRY_RUN 未关闭或缺少真实付费确认。'} … } `` ｜ 建议口径：`主区只留「当前是演练模式：没有真实调用模型，也没有产生费用」；DRY_RUN / JELLYFISH_DRY_RUN 下沉技术详情`
- [模式 6] `pages/aiStudio/llmPipeline/LlmPipelinePage.tsx:71-88` `Warnings` 组件，被 **9 处**调用（`:333,446,557,650,883,911,1156,1225,1294`）｜ 当前文案：`` <Warnings items={result.warnings as string[]} /> `` → `` <li key={`${index}-${text.slice(0, 12)}`}>{text}</li> ``（**后端 warnings 原文逐条上屏**）｜ 建议口径：`在 Warnings 组件内部统一 {maskInternalIds(text)}，一处改覆盖 9 个出口`
- [模式 6] `pages/aiStudio/main.tsx:44-51` ｜ 当前文案：`<h2>页面加载出错</h2>` + `<pre style={{ color: '#c00', overflow: 'auto' }}>{this.state.error.message}</pre>` **【静态+运行时】**（运行时实测：访问不存在的项目 ID `/projects/00000000-0000-0000-0000-000000000000?step=image_prep` → 整页 `页面加载出错` + `Rendered fewer hooks than expected. This may be caused by an accidental early return statement.`，**侧边导航全部消失**）｜ 建议口径：`**顶层 ErrorBoundary 把原始异常整页直渲，是唯一一条让页面完全不可用的泄漏**；主区给「页面出错了，请刷新重试；若仍不行请回到项目列表重新进入」，原文收进默认收起的技术详情。**同时必须修触发它的早期 return 路径**（ProjectWorkbench/index.tsx 项目不存在分支应渲染保留 MainLayout 侧边导航的正常空态页，而不是抛到 ErrorBoundary）——否则"给用户一句中文"仍然无路可走；截图 p2_e3_bad_project-1.png`
- [模式 3] `pages/aiStudio/assets/assetResultSummary.ts:511-521` `fallbackFailureText()` ｜ 当前文案：`` `上游返回「${statusText}」但没有给出失败原因：图片可能已生成，但 OSS 上传 / 落库没完成（这条结果暂时不能采纳）。` `` / `` `上游返回「${statusText}」但没有给出失败原因，请查看出图服务日志。` `` / `` `上游返回「${statusText}」，没有更多信息。` ``（`statusText` = 枚举原值 `partial_failed` / `failed` / `running`）｜ 建议口径：`**枚举原值拼进中文句子**，违反「原值绝不出现」，且句尾含内部口径（OSS 上传 / 落库 / 出图服务日志）。改：「图片已生成，但没能长期保存，所以暂时不能采纳（可稍后刷新这一项，或重新生成）」/「生成失败（服务没有给出原因）」/「这一项还没有结果」；statusText 只进技术详情`
- [模式 3] `pages/aiStudio/assets/assetResultSummary.ts:72` ｜ 当前文案：`/** 原始 status / outcome 文本（原样展示，让用户看到 partial_failed 这种真话） */` ｜ 建议口径：`**这条注释是有意为之，与新口径直接冲突** → 必须同时改注释与实现，否则下一个人会照注释改回去。改为「原始 status / outcome 文本（**只进技术详情**；主区一律用 ASSET_OUTCOME_LABEL 的中文口径）」`
- [模式 3] `pages/aiStudio/assets/assetResultSummary.ts:892-897` `countsText` ｜ 当前文案：`` `成功 ${okCount} / 失败 ${failedCount}` `` / `` `成功 ${okCount} / 失败 ${failedCount}，${countNotes.join('、')}（既不算成功也不算失败）` `` ｜ 建议口径：`按 §6.3 口径改「**部分失败（成功 X/共 Y）**」；countNotes 里的「状态未识别 / 演练占位」属可读中文，保留`
- [模式 3] `pages/aiStudio/assets/assetResultSummary.ts:958-960,965` `detailLines` ｜ 当前文案：`` `${countsText}（共 ${total} 条，${ossPart}）` ``（实测口径形如 `成功 3 / 失败 2（共 5 条，OSS 长期地址就绪 1 条）`）/ `` `失败原因：${text}` `` | 建议口径：`「OSS 长期地址就绪 N 条」属内部口径 → 改「其中 N 条已保存为长期图片」；「失败原因：${text}」属折叠依据层（逐条明细），主区只留条数`
- [模式 6] `pages/aiStudio/shots/components/ShotAudioBindingSection.tsx:330`（同款 `:337`；数据源 `pages/aiStudio/shots/components/audioAdmissionCore.ts:151`）｜ 当前文案：`` detail: text(audit.excluded_reason) \|\| '供应商取不到这条声音，本次生成请求不会携带它。' `` → `{admission.detail}` ｜ 建议口径：`**这条路径根本没有掩码**（全文件 maskInternalIds 引用 0 次），后端 excluded_reason 原文（可能含 file_id / storage_key / asset:// / 本机地址）原样上屏；出口加 maskInternalIds + 业务化改写，兜底串里的「供应商」也要换成「生成服务」→「这条声音这次送不出去：生成服务取不到它」`
- [模式 2] `pages/aiStudio/assets/components/AssetEditPageBase.tsx:1650-1660` ｜ 当前文案：`message="缺少项目作用域：出图已禁用"` + `从全局资产库直接打开时拿不到资产所属项目，出图无法定位资产。请先从「项目工作台 → 第 2 步 资产准备」进入本页，或在这里选择项目。` **【静态+运行时】**（运行时见于 `/assets/scenes/{id}/edit` 顶部）｜ 建议口径：`「项目作用域」「全局资产库」「无法定位资产」都是内部实现口径 → 「还不知道这个资产属于哪个项目，所以暂时不能出图」+「请从项目工作台的『第 2 步 资产准备』进入，或在这里选一个项目」`
- [模式 4] `pages/aiStudio/models/ProvidersTab.tsx:269`（同款 `:539`、`:581`）｜ 当前文案：`<Tooltip title={url}>{maskUrl(url)}</Tooltip>` / `title={p.base_url}` / `<Tooltip title={selectedProvider.base_url}>` —— **悬停即见完整本机/供应商地址**（运行时实测 `title="https://***art.ai/v1"`、`title="http://***1:4321/v1"`、`title="https://***ek.com/v1"`）**【静态+运行时】** ｜ 建议口径：`可见文本掩码而 title 给全文等于掩码白做 → 两者口径统一。**这条同时给出扫描规则要求：阶段 B 的禁词扫描必须覆盖 JSX 属性值（title / tooltip / placeholder / alt / aria-label），不能只扫可见文本**`

- [模式 1+2+3+4 合并] `pages/aiStudio/assets/components/AssetEditPageBase.tsx:2316-2328`（演员/场景/道具/服装编辑页**共用**的批量出图结果面板）｜ 当前文案：字面标签 `oss_url：`（`:2319`）+ `<a href={row.oss_url} target="_blank" rel="noreferrer">{row.oss_url}</a>`（`:2321-2322`，**完整 OSS 地址同时作链接文本与 `href`**）+ 同排 `{row.source_asset_id}`（`:2316`）+ `DRY_RUN 下为空，未上传 OSS`（`:2328`）｜ 建议口径：`**四种模式挤在同一行**——模式 1（source_asset_id）+ 模式 2（oss_url：字段名标签）+ 模式 3（DRY_RUN）+ 模式 4（完整 OSS 地址 / object key）。列名改「图片长期地址」，行内只显示「查看图片」链接；原始 OSS 地址（bucket / prefix / object key）与 source_asset_id 进技术详情；「DRY_RUN 下为空，未上传 OSS」改「当前是演练模式，没有上传长期存储」。触发按钮是「批量生成选中项 / 批量重新生成已选项 / 资产编辑页生成」→ 本项目出图 0 张，**源码路径确定但未实测上屏**`
  > 本条为**跨模式合并条目**（同一行同时命中 4 类）。为避免重复计数，其分模式落点已在 §4.6 模式 1（`:2308`/`:2316`）、模式 2（`:2307`/`:2319`）、模式 4（`:2321-2322`/`:2272`）与 §6.3 分别登记；本条**单独计入总数，不计入模式 1-6 的分项**。

#### 本区域合规对照（勿误判）
- 已确认**干净**：`assets/AssetManager.tsx`、`ActorAssetEditPage.tsx`、`CostumeAssetEditPage.tsx`、`assets/tabs/{ActorsTab,CostumesTab,PropsTab,ScenesTab}.tsx`、`assets/components/{ActorEntityFormModal,DisplayImageCard,StudioAssetTypeFormModal}.tsx`、`editor/VideoEditor.tsx`（只有 `:28 message.error('加载时间线失败')`）、`files/FileManager.tsx`（无 `storage_key`/`href`/`window.open`）、`hooks/useGenerationDraft.ts`、`shots/components/ChapterShotPreparationGuide.tsx`、`ChapterShotBasicInfoSection.tsx`（枚举→中文映射完整）、`bindingRecommendationRules.ts`
- 复制按钮专项：6 个 `navigator.clipboard.writeText` 调用点（`ChapterStudio.tsx:7253`、`StudioStepProgressStrip.tsx:172`、`ProjectStudioStepPanel.tsx:333`、`PromptFlowPage.tsx:1004,1468`、`LlmPipelinePage.tsx:1317`）**全部只复制提示词/交付文本，无一复制 URL** ✅
- 正向参考：`shots/components/ShotAudioBindingSection.tsx:344` 硬编码了 `已绑定（内部 ID 见工作区「技术详情」）` —— 这就是目标口径；只是它旁边 `:252-258` 又把 `seedance`/`audio_urls`/`供应商` 写进主区，**同一屏内自相矛盾**
- ⚠️ `llmPipeline/LlmPipelinePage.tsx`（1396 行）**在 `:1354` 自声明「这是开发调试工具，不是正常用户的生产入口」**，页面标题「LLM 编排调试台」。若只对开发可见，本节该页 30+ 条可整批降级（见 §9 第 1 项）

### 4.7 设置 / 模型页（+ 服务层 `services/`）

#### 服务层（跨页面传播源 —— 最高杠杆）
- [模式 6] `services/llmPipelineApi.ts:58-61`（`callApi`）｜ 当前文案：`` const suffix = detail ? `（${typeof detail === 'string' ? detail : JSON.stringify(detail)}）` : '' `` + `` String(error.message ?? payload?.message ?? text ?? `HTTP ${response.status}`) + suffix `` ｜ 建议口径：`detail/message/text 收进 GenerationRequestError 的技术字段，message 只保留中文结论`
- [模式 6] `services/llmPipelineApi.ts:87-90`（`callApiDelete`，同型）｜ 当前文案：与上完全同型（detail → JSON.stringify → 拼进 message）｜ 建议口径：`同上`
- [模式 6] `services/llmPipelineApi.ts:114-117`（`callApiPatch`，同型）｜ 当前文案：与上完全同型 ｜ 建议口径：`同上`
- [模式 6] `services/llmPipelineApi.ts:581` ｜ 当前文案：`` String(error.message ?? payload?.message ?? text ?? `HTTP ${response.status}`) `` ｜ 建议口径：`**这一处连 text（整个响应体）都当兜底且不加任何中文前缀，是最裸的一处**；改「剧本文件解析失败」+ 技术字段`
- [模式 2] `services/llmPipelineApi.ts:859` ｜ 当前文案：`` '视频已生成但登记素材失败（没有拿到 file_id）' `` ｜ 建议口径：`「视频已经生成，但没有登记成功；请重试，或打开『技术详情』查看记录」`
- [模式 4] `services/llmPipelineApi.ts:1292` ｜ 当前文案：`` throw new Error(`导出失败：HTTP ${response.status}${text ? `（${text.slice(0, 120)}）` : ''}`) `` ｜ 建议口径：`「导出失败，请稍后重试」；响应体前 120 字可能含 URL / 字段名`
- [模式 6] `services/orchestrationStatusApi.ts:49-52` ｜ 当前文案：`` const message = typeof payload?.message === 'string' ? payload.message : text.slice(0, 200) `` → `` `读取守卫状态失败（HTTP ${response.status}）：${message || '无响应体'}` `` ｜ 建议口径：`后端 message / 响应体前 200 字原样上行，最终在 RealRunModeBadge.tsx:189 主区 Alert 直渲`
- [模式 6] `services/generated/core/request.ts:281`（相关 `:254-260`）｜ 当前文案：`` `Generic Error: status: ${errorStatus}; status text: ${errorStatusText}; body: ${errorBody}` `` / `400: 'Bad Request', 401: 'Unauthorized', …` ｜ 建议口径：`未在 errors 映射里的状态码会把**完整响应体 JSON**（可能内嵌 UUID / file_id）塞进 ApiError.message，进而被页面 message.error(error.message) 直渲。生成物不建议手改 → 在封装层统一过 maskInternalIds`
- [模式 2] `services/juriluDiagnostics.ts:69`（同款 `:114`）｜ 当前文案：`` `${STAGE_SCRIPT}（未取到 scriptId）` `` / `` parts.push(`接口阶段 ${stage}`) `` ｜ 建议口径：`「脚本接口（未取到脚本编号）」` / `「脚本接口 / 分镜接口」`
- [模式 3] `services/juriluDiagnostics.ts:87`（同款 `:90,96`）｜ 当前文案：`` `响应声明编码 ${decodeErrors.join('/')}，但载荷没解开（我方解析问题，不是接口拒绝）` `` / `` `响应用了暂不支持的编码 ${unsupported.join('/')}（需要补解析器）` `` / `'接口返回 2xx 但确实没有分镜记录（不是凭证问题）'` ｜ 建议口径：`「接口返回的内容格式我方没能解析（不是你账号的问题）」` / `「接口用了本版本还不支持的内容格式，需要升级后再试」` / `「接口调用成功，但这一集确实没有分镜记录（不是账号问题）」`
- [模式 2] `services/juriluDiagnostics.ts:116-117` ｜ 当前文案：`` `带 Cookie：${diag.has_cookie ? '是' : '否'}` `` / `` `额外带 Authorization：${diag.has_auth ? '是' : '否'}` `` ｜ 建议口径：`「已带登录凭证：是 / 否」` / `「已附授权头：是 / 否」`
- **结构性缺口**：`services/` 全域引用 `maskInternalIds` **0 次**。建议在 `llmPipelineApi` / `orchestrationStatusApi` / `http` 的错误构造处套一层，而不是靠每个页面自觉

#### 设置页
- [模式 3] `pages/Settings.tsx:18,30,34,55,58`（i18n 命名空间前缀缺陷）｜ 当前文案：`/settings` 整页原样显示 key：`settings.title` / `settings.nickname` / `settings.role` / `settings.darkMode` / `settings.validation.nicknameRequired`，首屏即见 **【运行时】** ｜ 建议口径：`根因不是「词典缺失」——locales/zh-CN/settings.json **已有全部键**。真因是 `Settings.tsx:6 useTranslation(['settings','common'])` 把默认命名空间设成了 settings，而代码写 `t('settings.title')` → 实际查找 `settings:settings.title` → 永远 miss，i18next 回显 key。修法二选一：① 全部改成 `t('title')`（推荐，贴合已设的默认 ns）；② 改成 `t('settings:title')``
- [模式 3] `pages/Settings.tsx:68` ｜ 当前文案：`{t('common:save')}` 渲染为 `Save` **【运行时】** ｜ 建议口径：`该键命中、翻译正确；显示英文是因为 LanguageDetector 按 `localStorage → navigator → htmlTag` 解析出 en-US（`store/useAppStore.ts:24` 的 `'zh-CN'` 默认值只用于下拉显示、不参与 i18n 初始化）。建议把 `lng` 显式初始化为 `zh-CN`，或让 store 与 detector 同源`
- [模式 3] `pages/Settings.tsx:44` ｜ 当前文案：`{ label: t('settings.roleOptions.admin'), value: t('settings.roleOptions.admin') }` ｜ 建议口径：`把翻译后的显示名当 value 存进 store；切英文后 role 变 Administrator 而 initialValues 仍是「系统管理员」→ 下拉无匹配、原样显示旧值。value 用稳定码（admin/operator/guest），显示才用 t()`

#### 模型页
- [模式 4] `pages/aiStudio/models/ProvidersTab.tsx:265`（同款 `:540`、`581`）｜ 当前文案：`{ title: 'Base URL', … render: (url) => <Tooltip title={url}>{maskUrl(url)}</Tooltip> }` / `Base URL：{maskUrl(p.base_url)}` **【静态+运行时】**（运行时见表头 `Base URL`、`AK/SK`）｜ 建议口径：`标签保留（供应商配置页允许技术性最强），但建议改「接口地址（Base URL）」，中文在前英文括注；可见文本掩码而 hover 给全文等于掩码白做，两者口径需统一`
- [模式 2] `pages/aiStudio/models/ProvidersTab.tsx:272` ｜ 当前文案：`` { title: 'AK/SK', render: () => <span><WarningOutlined … />******** / ********</span> } `` **【静态+运行时】** ｜ 建议口径：`已完成掩码（做对了）；建议标题改「访问密钥」并保留 `********` 显示`
- [模式 4] `pages/aiStudio/models/ProvidersTab.tsx:288,545` ｜ 当前文案：`render: (d: string) => <Tooltip title={d}>{d || '—'}</Tooltip>` / `{p.description || '—'}` ｜ 建议口径：`描述列原样直渲——运行时可见 `image_service_openai_shim.py`、`/images/generations` 这类**实现细节被写进供应商描述**。建议按形态过滤（含 `.py` / `/v1/` / `/images/` 的描述在列表只显示「自定义接入」，全文进技术详情），并从数据侧清理描述`
- [模式 4] `pages/aiStudio/models/ProvidersTab.tsx:545-547` ｜ 当前文案：`创建：{p.created_by}` **【运行时】**（运行时见创建人 `integration`）｜ 建议口径：`「创建人」表列 + `created_by` 原值属运维信息；改显示「系统预置 / 由 <用户名> 创建」，`integration` 这类服务账号名映射为「系统」`
- [模式 5] `pages/aiStudio/models/ProvidersTab.tsx` 供应商名/地址列 ｜ 当前文案：值 `apimart`、`http://***1:4321/v1`（本机地址）**【静态+运行时】** ｜ 建议口径：`供应商名属本页核心功能、允许保留；但 `http://***1:4321/v1` 是**本机地址形态**，建议对非公网地址额外标注「仅本机可达，外部服务取不到」，避免用户误以为可用于生产`
- [模式 5] `pages/aiStudio/models/ProvidersTab.tsx:684` ｜ 当前文案：`<Input placeholder="https://api.openai.com/v1" />` ｜ 建议口径：`「例如：https://你的服务商接口地址/v1」` —— 占位符写死具体友商域名
- [模式 5] `pages/aiStudio/models/ModelsTab.tsx:691`（同款 `ProvidersTab.tsx:699`）｜ 当前文案：`<Input placeholder="例如：GPT-4" />` / `<Input.TextArea rows={2} placeholder="支持 GPT 系列模型" />` ｜ 建议口径：`「例如：文本生成模型 A」` / `「例如：本供应商负责的能力范围」`
- [模式 4] `pages/aiStudio/models/constants.ts:25-33` ｜ 当前文案：`` catch { return url.slice(0, 20) + '***' } `` ｜ 建议口径：`URL 解析失败时前 20 字符原样外泄；改「（地址格式不合法）」`
- [模式 3] `pages/aiStudio/models/SettingsTab.tsx:108-111` ｜ 当前文案：`{ label: 'Debug', value: 'debug' }`（Info / Warn / Error 同）｜ 建议口径：`「调试 / 常规 / 警告 / 错误」`
- [模式 3] `pages/NotFound.tsx:11-13`（文案源 `locales/en-US/notFound.json`）｜ 当前文案：`status="404" title="404"` + `Sorry, the page you visited does not exist.` / `Back Home`（未知路由整页英文）**【运行时】** ｜ 建议口径：`title 改「页面不存在」；文案**不是缺翻译**——locales/zh-CN/notFound.json 已有「抱歉，您访问的页面不存在。」「返回首页」，:7 的 useTranslation('notFound') 命名空间用法也正确。显示英文是 i18next 被 LanguageDetector 解析为 en-US → 显式初始化 lng: 'zh-CN'（与 Settings.tsx 同一根因）`
- [模式 2] `pages/aiStudio/models/ModelsTab.tsx:726`（同款 `:310,312`）｜ 当前文案：`label="参数（JSON）"` / `<Tooltip title={JSON.stringify(p)}>` + `JSON.stringify(p).slice(0, 30)` ｜ 建议口径：`改「高级参数（技术配置）」并折进默认收起区块；列表列只显示「已配置 N 项」`
- [模式 2] `pages/aiStudio/models/ProvidersTab.tsx:668` ｜ 当前文案：`<Form.Item name="name" label="名称" rules={[{ required: true, message: '请选择供应商' }]}>` ｜ 建议口径：`label 写「名称」但校验提示说「请选择供应商」→ 改「请填写名称」`
- [模式 3] `pages/aiStudio/layouts/../../layouts/MainLayout.tsx:59` ｜ 当前文案：`agents: 'Agent管理',` ｜ 建议口径：`「智能体管理」`
- [模式 3] `pages/aiStudio/store/../../store/useAppStore.ts:21` ｜ 当前文案：`name: 'Admin',` ｜ 建议口径：`「管理员」；该值经 MainLayout.tsx:271 直渲在右上角`

#### 语言包 / 共享组件
- `locales/zh-CN/**`（4 个 json）：**无英文枚举漏网**（`layout.json:14` 的 `"English"` 是语言切换项名称，正常）
- `components/CustomButton.tsx`、`CustomCard.tsx`、`App.tsx`、`pages/NotFound.tsx`：**无文案泄漏**（内容全由 `children` / i18n 传入）
- `models/{ModelsTab,ProvidersTab,SettingsTab}.tsx` 的 catch 全部只给中文兜底句（`:230/:211/:61` 等），**不直抛 ApiError 原文** —— 做对了的地方

---

## 5. 运行时走查结果

> 环境更正：走查对象就是 `/Users/apple/Documents/jellyfish-pr41`。
> **请求账目（三轮合计）**：只读 GET **1704**；只读 preview POST **13**（仅 `image-pipeline/plan/preview` 与 `video-plan/preview`，**页面加载自动触发**）；可能写入的非 GET 非 preview **0**；守卫拦截 **0**。
> 未点击的付费/写库按钮：分析本章资产、批量生成选中项、批量重新生成已选项、生成图片、生成提示词、生成这一镜、生成视频、采纳、设为定版、删除、保存到镜头、确认保存、提交类、任务中心「取消」、添加供应商、保存基础信息、**批量导出（`/files`）**、**用定版场景资产图批量出图**，以及全部 `Modal.warning` / `Modal.confirm` 的确认按钮（`确认真实生成（N 张）`、`知道了`）。

### 5.1 主区泄漏（可见原文）

| # | 页面区域 | 可见原文 | 模式 | 源码落点 | 建议口径 |
|---|---|---|---|---|---|
| R1 | 项目大厅 | `排序 createdAt ↓` | 2 | `ProjectLobby.tsx:54,92,360-364` | `「排序：创建时间（新→旧）」` |
| R2 | 项目大厅 | 项目名「孤立项目 script_9c3aafd08a（迁移）」 | 1（轻度） | `ProjectLobby.tsx:633,726,964` | `数据侧改名；前端对「孤立项目 <hash>（迁移）」形态折叠为「未命名项目（迁移）」` |
| R3 | 工作台步骤 1 | 更新时间直渲 `2026-09-26T04:02:58.135Z`（×2 行） | 3 | `tabs/ChaptersTab.tsx:537`（无 render） | `加 render：formatProjectTime(value)` |
| R4 | 工作台步骤 2 | 三处黄色警告条「等待后端契约」「降级视图」「本章资产资料接口还没有就绪（后端正在按契约实现）」 | 2 / 4 | `workbench/AssetWorkbench.tsx:405`、`workbench/assetWorkbenchContract.ts:373,377,467` | `「本章资产资料还在接入中：先按下面已有的数据查看资产与图片状态」`（**主区最大面积**） |
| R5 | 工作台步骤 3 | 批量导入表头「脚本组（script_id）」 | 2 | `components/JuriluScriptGroupPicker.tsx:213` | `「脚本组 1」` |
| R6 | 工作台步骤 5 | 「可交付来源：… / `external_import` / …」+「`imported_size` / `imported_resolution` / `recommended_duration` 元信息在 Jellyfish 侧没有等价列，因此未提供」 | 2 / 3 | `components/ProjectStudioStepPanel.tsx:48,351,356-358` | `「来源未记录」+「这些字段本项目暂时用不到」` |
| R7 | ChapterStudio | 视频准备度整排英文检查码：`未通过 · extraction_ready`、`通过 · duration_ready / prompt_ready / reference_frames_ready / video_model_ready / provider_ready / no_active_video_task` | 3 | `components/ChapterStudioVideoReadinessPanel.tsx:54` | `为 check.key 建中文映射；未登记项隐藏整行` |
| R8 | ChapterStudio | 「当前按 `text_only` 参考模式检查」 | 3 | `components/ChapterStudioVideoReadinessPanel.tsx:42` | `「当前按纯文本（不用参考帧）模式检查」` |
| R9 | ChapterStudio | 「为什么仍然是 `pending`」 | 3 | `components/ChapterStudioReadinessDiagnosisPanel.tsx:102` | `「为什么还在『待确认』状态」` |
| R10 | ChapterStudio | 「要求的帧：`first`」 | 3 | `components/shotStatusText.ts:55` → `ChapterStudio` 渲染 | `frameTypeLabel → 「首帧」` |
| R11 | ChapterStudio | 声音绑定长段落含 `seedance`、`audio_urls`、`generate_audio`、`asset://`、`/files/...`、`data URL`、仓库文件名 `SIX_STEP_ACCEPTANCE.md` | 2 / 4 / 5 | `components/ShotAudioBindingSection.tsx:250-258` | `整段改业务话术（见 §4.3 模式 4/5）；技术细节下沉` |
| R12 | ChapterStudio | `**输入**` markdown 未渲染，字面显示星号 | 渲染缺陷 | `components/ShotAudioBindingSection.tsx` 同段 | `改用 JSX 强标签或统一行内富文本渲染器` |
| R13 | ChapterStudio | 「该帧槽位没有 文件编号」「四类槽位的建议…推荐接口只读不写库」 | 2 | `ChapterStudio.tsx:6451,6477`（经 `maskInternalIds`） | `maskInternalIds 只换了 file_id，**「槽位」「接口」原样留下** → 扩词表：`槽位→图片角度`、`接口→服务`、`推荐接口→推荐结果`` |
| R14 | ChapterStudio | 「技术详情」收起态标签正文即含「供应商、内部 ID、file_id / storage_key、接口参数」 | 2 | `components/ShotProductionWorkspace.tsx:153` | `「内部标识与调用参数（默认收起）」` |
| R15 | 任务中心 | 任务类型标签英文原值 `video`（另两条是「图片生成」） | 3 | `components/taskCopy.ts:198` | `补映射 video→「视频生成」；兜底改「后台任务」` |
| R16 | 任务中心 | 「耗时 206 小时 26 分／797 小时 16 分」仍标「运行中」 | 非 6 类（误导） | `components/TaskCenter.tsx` | `陈旧 running 任务显示「状态未知（超过 N 小时未更新）」+「标记为已失效」动作` |
| R17 | 提示词看板 / 资产抽屉 | 资产详情抽屉「资产资料」行标签中英混杂 `relations` / `related_plot` / `shot_refs` | 2 | `workbench/workbenchState.ts:622-647,650` | `以 ASSET_PROFILE_FIELD_SPECS 为唯一来源生成标签表` |
| R18 | `/prompt-flow` | 「高级选项（Authorization / Referer / API 覆盖 / 写入开关）」 | 2 / 4 | `PromptFlowPage.tsx` 高级选项区块（约 `:880-960`） | `「高级选项（登录凭证 / 来源页 / 接口地址覆盖 / 是否写回）」` |
| R19 | 实体管理 `/assets?tab=scene` | 描述文本直渲「已根据该资产出现的 `segments、shots、台词、visual_focus、continuity_note 和 story_function` 生成」 | 2 | `AssetTypeTab.tsx:262`（`{a.description}`，后端生成文本） | `前端改为「已根据该资产在本集剧本里的出场、台词与作用生成」；英文字段名不进主区` |
| R20 | 实体管理 `/assets/scenes/{id}/edit` | 面包屑含 percent-encoded ID 与英文段 `scenes` | 1 / 4 | `layouts/MainLayout.tsx:99` | `面包屑兜底禁止回落 URL 段；未登记段给业务名` |
| R21 | 实体管理 `/assets/scenes/{id}/edit` | 标题 `SCENE_星耀疗养院S级特护病房门外` | 1 / 数据侧 | 资产名（数据） | `数据侧改名；前端可对 `SCENE_` 前缀做展示层剥离` |
| R22 | 实体管理 `/assets/scenes/{id}/edit` | 「资产类型：`scene` 项目作用域：未识别」 | 3 / 1 | `AssetEditPageBase.tsx:1636,1638` | ``scene→场景`；作用域显示项目名而非 UUID` |
| R23 | 实体管理 `/assets/scenes/{id}/edit` | 「照片角度：正面 **ID 23**」 | 1 | `AssetEditPageBase.tsx:1689` | `去掉数字 ID，或移入技术详情` |
| R24 | 设置 `/settings` | 整页 i18n key 未翻译：`settings.title` / `settings.nickname` / `settings.role` / `settings.darkMode` / `Save` | 3 | `Settings.tsx:18,30,34,55,58,68` | `**根因是 i18n 命名空间前缀缺陷，不是词典缺失**（词典已有全部键）：`useTranslation(['settings','common'])` 已设默认 ns，代码又写 `t('settings.title')` → 查 `settings:settings.title` 永远 miss。改 `t('title')` 或 `t('settings:title')`；`Save` 因 LanguageDetector 解析出 en-US，建议显式初始化 `lng: 'zh-CN'`` |
| R25 | 模型 `/models` | 表头 `Base URL` / `AK/SK`；值 `apimart`、`http://***1:4321/v1`（本机地址）、`image_service_openai_shim.py`、`/images/generations`；创建人 `integration`；**`title` 悬停属性** `title="https://***art.ai/v1"` / `title="http://***1:4321/v1"` / `title="https://***ek.com/v1"` | 4 / 5 | `ProvidersTab.tsx:265,269,272,288,539,540,545-547,581` | `标签中文化；非公网地址标注「仅本机可达」；描述里的实现细节过滤或折进技术详情；`integration` 映射为「系统」；**`title` 属性与可见文本口径统一**（掩码了正文却给全地址 tooltip 等于掩码白做）` |
| **R26** | 项目工作台（**第 2/3 轮新增，本轮最严重**） | 访问不存在/已删除项目 ID `/projects/00000000-…?step=image_prep` → **整页** `页面加载出错` + `Rendered fewer hooks than expected. This may be caused by an accidental early return statement.`，且**侧边导航全部消失**，用户无从下手 | **6** | `main.tsx:44-51` 顶层 ErrorBoundary（`:48` 直渲 `this.state.error.message`）；触发源为 `ProjectWorkbench/index.tsx` 的早期 return 路径 | `「页面出错了，请刷新重试；若仍不行请回到项目列表重新进入」` + 原文折叠进技术详情（与 `main.tsx` ErrorBoundary 口径合并处理）；截图 `p2_e3_bad_project-1.png` |
| **R27** | 未知路由 404（第 2/3 轮新增） | `404` / `Sorry, the page you visited does not exist.` / `Back Home` | 3（文案缺口） | `pages/NotFound.tsx:11-13,16` + `locales/en-US/notFound.json` | `**根因同 R24，不是缺翻译**：`locales/zh-CN/notFound.json` 已有「抱歉，您访问的页面不存在。」「返回首页」。显示英文是因为 i18next 被 LanguageDetector 解析为 en-US；修 `lng` 初始化即可。另 `title="404"` 建议改「页面不存在」`；截图 `p2_e5_unknown_route-1.png` |

### 5.2 最严重 5 条（运行时判定，**已按第 2/3 轮新证据重排**）

1. **不存在项目 ID → 整页英文 React 框架报错** —— `Rendered fewer hooks than expected…` 整屏上屏且**侧边导航消失**，用户完全无从下手；影响面是"任何一次错误跳转/已删除项目的历史链接"（R26）
2. **`partial_failed` / `failed` / `running` 枚举原值拼进中文失败句** —— 违反"枚举原值绝不出现"，且句子骨架就是中文，用户会以为这是正常提示；这是**批量出图结果面板**的主口径（`assetResultSummary.ts:511-521`，见 §5.5-B）
3. **资产编辑页结果行四种泄漏挤在同一行** —— `oss_url：` + 完整 OSS 地址（同时作链接文本与 `href`）+ `{row.source_asset_id}` + `DRY_RUN 下为空，未上传 OSS`，模式 1/2/3/4 一次到位；一旦有出图就上屏（`AssetEditPageBase.tsx:2316-2328`，见 §5.5-C）
4. **`/settings` 整页 i18n key 未翻译** —— 首屏即见、影响所有用户、修法一行（R24，同类根因也命中 404 页 R27）
5. **ChapterStudio 视频准备度英文检查码**（R7）；**`/models` `Base URL` / `AK/SK` / `http://***1:4321/v1` / `apimart`（含 `title` 悬停属性，R25）** —— 两者并列第 5

> 相比第 1 轮，下降的是「工作台步骤 2 大警告条」（R4）与「场景编辑页 `SCENE_...` 三连」（R20-R23）——它们仍是有效泄漏，但严重度低于上述 5 条：前者是**可读的中文开发术语**，后者是**单个首屏的模式 1**；而新 Top 3 里第 1 条让页面**完全不可用**，第 2/3 条则是**每次出图都会命中**的主口径。

### 5.3 合规对照（分层在多数页面成立）

工作台各步与工作室的**「技术详情」展开后**包含：`deepseek-chat` / `openai` / `image2` / `seedance-2.0-mini` / `apimart`、`active` / `testing` / `configured`、`chapter=33696d3f-…`、`/api/v1/...`、`asset_id` / `file_id` / `service_task_id`、`resolveProjectStep 入参` JSON、`后端原始提示 Required frame image is missing: first`。

**这些在主区文本 0 命中** —— 说明三层模型的设计意图在多数页面是**成立**的，问题集中在少数渲染点而非整体架构。这是阶段 B 可以直接复用既有机制（`TechnicalDetailCollapse.tsx`、各种 `tech_*` 折叠块）而不必重构的依据。

**第 2/3 轮新增的合规样本（同样要写进文档，作为"应学范例"）**：

| 场景 | 实测表现 | 判定 |
|---|---|---|
| 非法章节 ID（`p2_e1_bad_chapter_studio-1.png`） | 优雅降级为空态 `本集还没有镜头` | ✅ **合规，且是错误 ID 处理的应学范例** —— 与 R26（不存在项目 ID 直接炸整页）形成对照：同一类"非法 ID"输入，ChapterStudio 降级、ProjectWorkbench 崩溃 |
| 非法场景 ID | 静默降级、无泄漏 | ✅ 合规 |
| 非法 `chapter` 参数 | 静默降级、无泄漏 | ✅ 合规 |
| 复制按钮（**本轮实测真的点了一次**） | 工作台第 5 步「复制交付文本」→ 剪贴板得到 6650 字交付正文；**对剪贴板内容做模式 1/4 正则扫描 0 命中** | ✅ 合规；工作室无可见复制按钮，`/files` 与工作台文件页亦无。与静态结论（6 个 `navigator.clipboard.writeText` 调用点全部只复制提示词/交付文本）**互相印证** |
| 声音绑定 `已绑定，但供应商无法访问`（`[role=alert]`） | 后端 `excluded_reason` 掩码后直渲 | ⚠️ 标题**已业务化**（保留）；但 `detail` 走的路径**未真正掩码**，见 §5.5-F |

### 5.4 未覆盖 / 无法判定

| 项 | 原因 |
|---|---|
| 待处理抽屉（`PendingReviewDrawer`） | 本项目 0 项，入口不存在，未打开 |
| 生成结果卡片（`AssetResultCard` / `ProductionTask` 列表） | 0 项，无数据 |
| **批量出图结果面板**（`AssetEditPageBase.tsx:2316-2328`、`assetResultSummary.ts` 全部汇总文案） | 本项目出图 **0 张**，触发按钮是「批量生成选中项 / 批量重新生成已选项 / 资产编辑页生成」→ **存在但无法只读触发**；§5.5-B/C 的条目**以源码为据**，非实测上屏 |
| 大厅「视图 / 批量」入口、`/files`「批量导出」 | 未点（可能触发写库） |
| 场景编辑页「生成 / 设为定版 / 上传」、`用定版场景资产图批量出图` | 未点（会写库） |
| 全部 `Modal.warning` / `Modal.confirm` 确认按钮 | 未点（`确认真实生成（N 张）`、`知道了`） |
| 后果 | 与这些路径相关的静态条目**只有源码证据，无运行时确认** —— 阶段 B 修完后需用截图对比补上实测 |

### 5.5 第 2/3 轮追加发现（同一份只读走查）

#### 5.5-A 模式 6 的最严重出口（全新）

| # | 触发 | 可见原文 | 模式 | 判定与建议 |
|---|---|---|---|---|
| A1 | `http://localhost:5173/projects/00000000-0000-0000-0000-000000000000?step=image_prep` | **整页**：`页面加载出错` + `Rendered fewer hooks than expected. This may be caused by an accidental early return statement.`，**侧边导航全部消失**，用户无从下手 | **6** | 英文 React 运行时原文整页上屏。建议口径：`页面出错了，请刷新重试；若仍不行请回到项目列表重新进入` + 原文折叠进技术详情（**与 `main.tsx:44-51` 顶层 ErrorBoundary 口径合并处理**）。截图 `p2_e3_bad_project-1.png` |
| A2 | 未知路由 | `404` / `Sorry, the page you visited does not exist.` / `Back Home` | 3（中文产品里的文案缺口） | **根因同 R24，不是缺翻译**（见 §5.5-A 末段）。截图 `p2_e5_unknown_route-1.png` |
| A3 | 非法章节 ID（`p2_e1_bad_chapter_studio-1.png`） | 优雅降级为空态 `本集还没有镜头` | — | ✅ **合规，且是"非法 ID 处理"的应学范例**（与 A1 形成强对照：同一类非法 ID 输入，ChapterStudio 降级、ProjectWorkbench 崩溃） |
| A4 | 非法场景 ID、非法 `chapter` 参数 | 静默降级、无泄漏 | — | ✅ 合规 |

**A1 的额外价值**：它是本次审计中**唯一一条让页面完全不可用**的泄漏，且其暴露的**不只是文案问题** —— 侧边导航消失说明早期 `return` 绕过了布局渲染。阶段 B 修文案的同时**必须**修这条早期 return 路径（否则"给用户一句中文"仍然无路可走）。修法建议：在 `ProjectWorkbench/index.tsx` 的项目不存在分支里渲染一个正常的空态页（保留 `MainLayout` 侧边导航 + 「返回项目列表」按钮），而不是让它抛到顶层 ErrorBoundary。

**A2 的根因修正**：`locales/zh-CN/notFound.json` **已含全部中文**（`subTitle: "抱歉，您访问的页面不存在。"`、`backHome: "返回首页"`），`NotFound.tsx:7` 的 `useTranslation('notFound')` 命名空间用法也**正确**（不像 `/settings` 那样多写了前缀）。显示英文的唯一原因是 **i18next 被 LanguageDetector 解析为 `en-US`**（`detection.order: ['localStorage','navigator','htmlTag']`）——与 R24 中 `Save` 的成因相同。因此 404 页的修法与 `/settings` 共享同一步：显式初始化 `lng: 'zh-CN'`（或让 `useAppStore.language` 与 detector 同源）。**唯一需要独立改的是 `NotFound.tsx:11-12` 硬编码的 `status="404" title="404"`** → 「页面不存在」。

#### 5.5-B `partial_failed` 与新口径**直接冲突**的源码落点

| # | 落点 | 当前原文 | 模式 | 建议口径 |
|---|---|---|---|---|
| B1 | `assets/assetResultSummary.ts:511-521` `fallbackFailureText()` —— **把枚举原值拼进中文句子** | `` `上游返回「${statusText}」但没有给出失败原因：图片可能已生成，但 OSS 上传 / 落库没完成（这条结果暂时不能采纳）。` `` / `` `上游返回「${statusText}」但没有给出失败原因，请查看出图服务日志。` `` / `` `上游返回「${statusText}」，没有更多信息。` `` | 3 | 违反「枚举原值绝不出现」，且句尾含**内部口径**（OSS 上传 / 落库 / 出图服务日志）。改：`` 图片已生成，但没能长期保存，所以暂时不能采纳（可稍后刷新这一项，或重新生成） `` / `生成失败（服务没有给出原因）` / `这一项还没有结果` —— `statusText` 只进技术详情 |
| B2 | `assets/assetResultSummary.ts:72` | `/** 原始 status / outcome 文本（原样展示，让用户看到 partial_failed 这种真话） */` | 3（**根因注释**） | 注释**有意为之**，与新口径直接冲突 → 必须**同时改注释与实现**，否则下一个人会照着注释改回去。新注释建议：`/** 原始 status / outcome 文本（**只进技术详情**；主区一律用 ASSET_OUTCOME_LABEL 的中文口径） */` |
| B3 | `assets/assetResultSummary.ts:892-897` `countsText` | `` `成功 ${okCount} / 失败 ${failedCount}` `` / `` `成功 ${okCount} / 失败 ${failedCount}，${countNotes.join('、')}（既不算成功也不算失败）` `` | 3 / 2 | 按 §6.3 口径改「**部分失败（成功 X/共 Y）**」；`countNotes` 里的「状态未识别 / 演练占位」属可读中文，保留 |
| B4 | `assets/assetResultSummary.ts:958-960,965` `detailLines` | `` `${countsText}（共 ${total} 条，${ossPart}）` ``（即运行时口径 `成功 3 / 失败 2（共 5 条，OSS 长期地址就绪 1 条）`）/ `` `失败原因：${text}` `` | 3 / 2 / 6 | `OSS 长期地址就绪 N 条` 属内部口径 → 改「其中 N 条已保存为长期图片」；`失败原因：${text}` 属折叠依据层（逐条明细），主区只留条数 |
| B5 | `assets/components/AssetEditPageBase.tsx:2311-2312` / `llmPipeline/LlmPipelinePage.tsx:976,1209` | `<Tag>{normalized.rawStatus \|\| '未知'}</Tag>` / `{normalized.rawStatus \|\| '未知'}` | 3 | 枚举原值直渲 → 改用 `ASSET_OUTCOME_LABEL`（见 §4.6 已有条目） |

✅ **已有可复用（不要重写）**：
- `assetResultSummary.ts:155-162` `ASSET_OUTCOME_LABEL.partial_failed = '部分失败'` —— 中文口径的**唯一事实来源**，主区/明细层都应 import 它
- `assetProduction.ts:1129-1137 describeFailureReason()` 对 `partial_failed` 的中文兜底（「图片已经生成，但没有完成长期存储，因此暂时不可用；可以稍后刷新这一项，或重新生成。」）**是合格的**，应统一到它

> 注意：B1–B4 这些行都在**批量出图结果面板**里，触发按钮是「批量生成选中项 / 批量重新生成已选项 / 资产编辑页生成」→ **存在但无法只读触发**（本项目出图 0 张），本节条目**以源码为据**。

#### 5.5-C 四种泄漏挤在同一行（一旦有出图就上屏）

- 位置：`assets/components/AssetEditPageBase.tsx:2316-2328`（演员 / 场景 / 道具 / 服装编辑页**共用**的批量结果面板）
- 可见形态：字面标签 `oss_url：`（`:2319`）+ `<a href={row.oss_url} target="_blank" rel="noreferrer">{row.oss_url}</a>`（`:2321-2322`，**完整 OSS 地址同时作链接文本与 `href`**）+ 同排 `{row.source_asset_id}`（`:2316`）+ `DRY_RUN 下为空，未上传 OSS`（`:2328`）
- 四种模式一次到位：模式 1（`source_asset_id`）+ 模式 2（`oss_url：` 字段名标签）+ 模式 3（`DRY_RUN`）+ 模式 4（完整 OSS 地址 / object key）
- 现状：本项目出图 0 张，故本轮**未实测上屏**；**源码路径确定**
- 建议口径：列名改「图片长期地址」，行内只显示「查看图片」链接；原始 OSS 地址（bucket / prefix / object key）与 `source_asset_id` 进技术详情；`DRY_RUN 下为空，未上传 OSS` 改「当前是演练模式，没有上传长期存储」

#### 5.5-D 模式 4 的两条实测补充

- **`title` 属性也会泄漏**：`/models` 的 `Tooltip` / `title` 属性里带完整本机 / 供应商地址 —— `title="https://***art.ai/v1"`、`title="http://***1:4321/v1"`、`title="https://***ek.com/v1"`（源码 `ProvidersTab.tsx:269,539,581`）→ **悬停即见，算模式 4**。这意味着阶段 B 的扫描规则必须覆盖 **JSX 属性值**（`title=` / `tooltip=` / `placeholder=` / `alt=` / `aria-label=`），不能只扫可见文本。
- **复制按钮实测干净**：本轮**真的点了一次**工作台第 5 步的「复制交付文本」（纯前端 `navigator.clipboard`），剪贴板得到 **6650 字**交付正文，**对剪贴板内容做模式 1/4 正则扫描 0 命中**；工作室无可见复制按钮，`/files` 与工作台文件页亦无 → 与静态结论（6 个 `writeText` 调用点全部只复制提示词/交付文本）**互相印证**。
- 未点击（可能写库）：**`批量导出`（`/files`）**。

#### 5.5-E `[role=alert]` 两处实测原文（一处泄漏、一处已业务化）

| 位置 | 可见原文 | 判定 | 建议口径 |
|---|---|---|---|
| `/assets/scenes/{id}/edit` 顶部 | `缺少项目作用域：出图已禁用` + `从全局资产库直接打开时拿不到资产所属项目，出图无法定位资产。请先从「项目工作台 → 第 2 步 资产准备」进入本页，或在这里选择项目。`（源码 `AssetEditPageBase.tsx:1650-1660`） | ⚠️ **泄漏（模式 2）** —— 「项目作用域」「全局资产库」「无法定位资产」都是**内部实现口径**；用户看到的应该是"这一页不知道属于哪个项目，所以不能出图" | `「还不知道这个资产属于哪个项目，所以暂时不能出图」` + `「请从项目工作台的『第 2 步 资产准备』进入，或在这里选一个项目」` |
| 声音绑定 | `已绑定，但供应商无法访问`（`audioAdmissionCore.ts:150` 的 `title`） | ✅ **已业务化**（保留）—— 用户需要知道"这段声音这次用不上" | 标题保留；但配套的 `detail` 有独立问题，见 F |

#### 5.5-F `excluded_reason` 的实际渲染路径（比"掩码后直渲"更严重）

运行时观察记作「`excluded_reason` 掩码后直渲」，但**源码核对结果更严重：这条路径根本没有掩码**。

- 数据流：`audioAdmissionCore.ts:151` `` detail: text(audit.excluded_reason) || '供应商取不到这条声音，本次生成请求不会携带它。' `` → `ShotAudioBindingSection.tsx:139` `describeAudioAdmission(audioAudit)` → **`:330` `{admission.detail}`** 与 **`:337` `{admission.detail}`** 直接渲染
- 全文件 `maskInternalIds` 引用数：**0**（`grep -n maskInternalIds ShotAudioBindingSection.tsx` 无命中）
- 因此后端 `excluded_reason` 的**原文**（可能含 `file_id` / `storage_key` / `asset://` / 本机地址）会原样上屏；**不是"掩码后残留"**
- 建议口径：`detail` 出口加 `maskInternalIds` + 业务化改写；`|| '供应商取不到这条声音…'` 这个**兜底串本身**也要改（「供应商」是点名禁词）→ `「这条声音这次送不出去：生成服务取不到它」`

#### 5.5-G `maskInternalIds` 的能力边界（必须写进阶段 B 做法）

`maskInternalIds` **只做 ID 掩码与 4 个字段名替换，不改写后端原始措辞**。所以：

- 已掩码但**仍然上屏的后端话术**，本质仍是模式 2 / 6。实例（运行时实测）：`该帧槽位没有 文件编号：请先上传或生成该帧。` —— `file_id` 换成了「文件编号」✅，但「**槽位**」「**接口**」两个禁词原样留下，且「请先上传或生成该帧」仍是后端措辞
- **结论：`maskInternalIds` 之后还必须有一层"业务化改写（翻译）层"** —— 即把"掩码后仍不可读/仍含禁词"的句子整体换成前端自己的中文结论，原文只进技术详情。这一条已写入 §7.1-5 的包装层契约与 §7.3 的扩展项

### 5.6 关键观察：泄漏是"渲后端值"而非"写死后端值"

**大批泄漏的成因是渲染点直接把后端值渲出来，而不是文案字符串里写死了后端值。** 例证：

- ChapterStudio 视频准备度的英文码 `extraction_ready` / `duration_ready` … **来自 `checks` 数组的数据**（`ChapterStudio.tsx:3599` 定义 `checks` 类型、`:3633` 构造 `checks` 数组、`:3679` `expectedChecks` 过滤），面板只在 `ChapterStudioVideoReadinessPanel.tsx:54` 用 `{check.key}` 打印 —— 改文案字符串完全无效，必须在渲染点加映射
- R19 的 `segments/shots/visual_focus/...` 是**后端生成的 description 字段**，前端只是 `{a.description}`
- R6 的 `external_import` / `imported_size` 分别来自 `delivery.export_sources` 与 `delivery.note`（后端回包字段）
- R13 的「槽位 / 接口」是 `maskInternalIds` 转换后的**残留**，属映射层不完整
- R25 的 `image_service_openai_shim.py` / `/images/generations` 是**供应商描述字段的取值**

**结论**：阶段 B 的修法必须落在**渲染点 / 映射层**（统一映射表 + 统一 message 包装 + 统一的 `maskInternalIds` 出口），不能只做文案字符串替换。这也是为什么 §7 把「模式 3 建 `enumLabels.ts`」和「模式 6 建统一包装层」列为前置任务。

---

## 6. 三个边界项的最终口径

### 6.1 任务号 —— 一律进技术详情，主区不得出现

**依据**：用户对任务号**没有可操作场景**。界面上不存在按任务号查询、跳转、筛选、复制的入口；它唯一的价值是报障时提供给运维——那正是「技术详情」的用途。

**需按此口径整改的落点**：`AssetEditPageBase.tsx:2218,2307-2308,2316`、`LlmPipelinePage.tsx:894,964,1215`（`幂等键` 列改名「出图计划」并移入技术详情）、`taskCenterMeta.ts:63,80,87,122,137,162,167`（兜底分支）、`taskCopy.ts:208`、`EpisodeVideoPromptBoard.tsx:1410`、`useProjectStepSignals.ts:238`。

**唯一允许保留的形态**：
1. 技术详情折叠区内的「任务号 / 文件编号」行（`TechnicalDetailCollapse.tsx:78` 已是正确示例）
2. 取消接口的入参（`TaskCenter.tsx:407,454` 用 `task.taskId` 但**不上屏**）

### 6.2 模型方案名 —— 主区只用业务化说法，原始 provider / 模型 ID / 模型名进技术详情

**依据**：用户要判断的是「这套方案贵不贵、够不够快、能不能出我要的效果」，而不是「厂商叫什么」；模型名会随供应商切换而变，写进主区文案就等于把内部实现暴露成产品承诺。

**现成机制（照它补表）**：`useShotRequestPlan.ts:62-66 videoModelBusinessName()` + `VIDEO_MODEL_BUSINESS_NAMES`，`ChapterStudio.tsx:6550` 已在正确使用：

```
export function videoModelBusinessName(modelName: string | null | undefined): string {
  const key = String(modelName ?? '').trim()
  if (!key) return '未解析'
  return VIDEO_MODEL_BUSINESS_NAMES[key] ?? key
}
```

→ **阶段 B 按同一模式给「文本出口」与「图片出口」各补一张同型表**，主区统一显示「当前模型方案」。

**需按此口径整改的落点**：`ChapterStudio.tsx:6800`（`${provider} / ${model_name}` 主区 Tag）、`:7501`、`:7503`、`:7505`（`供应商：${provider}`）、`LlmPipelinePage.tsx:339,567,853,855,1105,1159,1161`、`generationGate.ts:118,128,135-137,141`、`generationStatusCore.ts:162,169`、`ChapterShotAssetBindingSection.tsx:457`、`PromptFlowPage.tsx:1445,1454,1690`。

**已合规、勿动**：`ChapterStudio.tsx:5731-5732,5745,5749`（在 `part('kf_specs')`，位于 `technical` 折叠块内）、`ProjectDevInfo.tsx:194,206-207`、`TechnicalDetailCollapse.tsx` 全文件。

**连带必改**：`generationStatusCore.test.ts:52` 的 `assert.match(info.description, /gpt-image-2/)` —— 它把「原始模型名必须在主区」冻结成期望值，按本口径必须改成「模型名只出现在技术详情层」，否则整改会红。

### 6.3 `partial_failed` —— 主区中文口径，枚举原值绝不出现

**依据**：`partial_failed` 的语义是「图生成了但没进长期存储，所以采纳不了」。用户需要知道的是**「成没成」和「能不能用」**，而不是这个词本身。

**主区文案模板（固定，不得各页自创）**：

| 场景 | 主区文案 |
|---|---|
| 批量头部 | **`部分失败（成功 X/共 Y）`** |
| 单条结果 | `生成失败（图片没成功保存，暂时不能采纳）` |
| 逐条明细（折叠依据层） | `图已生成，但没完成长期存储，所以暂时不可用；可稍后刷新或重新生成` |
| 技术详情层保留 | `outcome: partial_failed`、`by_outcome` 分布、逐条 `error_message`、`by_status` |

**正面基础（已有，要保住）**：`assetResultSummary.ts:32-59,144-147` 已保证 `partial_failed` 不算成功、不用绿色 Tag（volcano）；`:5-25` 的注释把口径写死了；`assetProduction.ts:1129-1137 describeFailureReason` 已是合格的中文转述——**本次应统一到它的口径**。

**需按此口径整改的落点**：`AssetEditPageBase.tsx:2311-2312`（`status：` + `{normalized.rawStatus || '未知'}` 直渲枚举原值）、`:2156`（`后端状态：${singleGenResult.status}`）、`:2194`（把 `partial_failed` 写进用户可读说明）、`LlmPipelinePage.tsx:976,1209`（`{normalized.rawStatus || '未知'}`）、`assetProduction.ts:1140`（源码里 `String(result.outcome) === 'partial_failed'` 是**内部判定**，保留即可，但 `outcome` 不得进文案）。

**第 2/3 轮补充的具体冲突落点（比上面更细，全部在批量出图结果面板）**：

| 落点 | 现状 | 处理 |
|---|---|---|
| `assetResultSummary.ts:511-521` `fallbackFailureText()` | **枚举原值拼进中文句子**：`上游返回「partial_failed」但没有给出失败原因：…` / `上游返回「failed」但没有给出失败原因，请查看出图服务日志。` / `上游返回「running」，没有更多信息。` | 整段重写：`图片已生成，但没能长期保存，所以暂时不能采纳（可稍后刷新这一项，或重新生成）` / `生成失败（服务没有给出原因）` / `这一项还没有结果`；`statusText` 只进技术详情 |
| `assetResultSummary.ts:72` | 注释 `/** 原始 status / outcome 文本（原样展示，让用户看到 partial_failed 这种真话） */` | **有意为之，必须同批改注释与实现**，否则会被人照注释改回去 |
| `assetResultSummary.ts:892-897` `countsText` | `成功 X / 失败 Y`（+ `（既不算成功也不算失败）`） | 改「**部分失败（成功 X/共 Y）**」 |
| `assetResultSummary.ts:958-960,965` `detailLines` | `` `${countsText}（共 ${total} 条，OSS 长期地址就绪 N 条）` `` / `失败原因：${text}` | 「OSS 长期地址就绪 → 已保存为长期图片」；逐条 `失败原因：` 属折叠依据层 |
| `AssetEditPageBase.tsx:2316-2328` | 结果行同排 `{row.source_asset_id}` + `oss_url：` + 完整 OSS 地址 + `DRY_RUN 下为空，未上传 OSS` | 见 §5.5-C（跨模式合并条目） |

**连带必改**：`assetProduction.test.ts` 与 `assetResultSummary.test.ts` 里把 `rawStatus` 原值当断言期望的用例需同步改为中文口径。

---

## 7. 阶段 B 执行计划

### 7.1 总原则

1. **每页独立 commit**，一个页面区域的改动不与其他区域混在同一个 hunk；混入时先拆分再提交。
2. **优先复用既有机制**，不新造轮子：
   - `maskInternalIds.ts` 已是正确设计的屏蔽工具，**当前仅 4 处引用** → 阶段 B 的第一杠杆是把它的引用点从 4 扩到全部主流程出口
   - 技术详情折叠形态**照 `ShotProductionWorkspace.tsx:150` 先例**（`Collapse` + `items` + `activeKey` 受控，默认不包含该 key）
   - `sanitizeUserText()`（`userFacingStatus.ts:45-63`）是第二道闸，与 `maskInternalIds` **叠加使用**（前者认内部术语词表 + `xxx_id=` 赋值式，后者认 UUID / `file_id=` / `storage_key=` / 裸字段名；两者都不完整，叠加后才够）
3. **不动 `ChapterStudio.tsx` 布局**：只收文案、加折叠、换映射。不重排组件树、不改变既有区块顺序与 `STEP_OPEN_KEYS` 语义。
4. **模式 3 统一到一个映射文件**：若确认全仓无统一的枚举→中文映射，则新建 `front/src/pages/aiStudio/components/enumLabels.ts`（**一处定义、全仓引用、配单测**）——**禁止每页各写一份**。现有可迁移进该文件的散落映射：`shotStatusText.ts` 的 `FRAME_LABELS`、`useShotRequestPlan.ts` 的 `REFERENCE_MODE_LABELS` / `VIDEO_MODEL_BUSINESS_NAMES`、`taskCopy.ts` 的 `TASK_KIND_TITLE_MAP`、`generationStatusCore.ts` 的 `OUTLET_LABEL`、`realRunModeCore.ts` 的 `MODE_LABEL` / `OUTLET_LABELS` / `AUDIT_LABELS`、`workbenchState.ts` 的 `WORKBENCH_STATUS_LABEL` / `PENDING_REVIEW_KIND_LABEL` / `PROFILE_FIELD_LABEL`、`assetResultSummary.ts` 的 `ASSET_OUTCOME_TAG_COLOR`、`audioAdmissionCore.ts` 的 `INCLUDED_TAGS` / `EXCLUDED_TAGS`。
   - 每个枚举类导出 `{ map, labelFor(key) }`，`labelFor` **未命中时返回固定中文兜底**（如「其他 / 状态待确认」），**绝不回显原值**
5. **模式 6 统一 message 包装层**：新建一个包装函数（建议 `front/src/pages/aiStudio/components/userMessage.ts`），契约固定为「**主区中文结论 + 可展开原文**」：

```
showUserError(outletLabel: string, raw: unknown, fallback: string): void
  → message.error(中文结论)                    // 主区
  → 原文经 maskInternalIds + sanitizeUserText 后写入「技术详情」可查处   // 折叠层
```
   - 迁移顺序：先改**管道**（`taskActionHelpers.ts:30-44`、`services/llmPipelineApi.ts:58-61/87-90/114-117/581`、`generationStatusCore.ts:328-330 failureText`、`ShotAudioBindingSection.tsx:330/337` 的 `excluded_reason` 出口），再逐页替换调用点 —— 管道改完后大量调用点自动受益
   - **包装层必须含"业务化改写"一步**（见下条）：`maskInternalIds` 之后仍不可读的句子，包装层要整体换成前端自己的中文结论，而不是把掩码后的句子直接上屏
6. **`maskInternalIds` 之后必须再有一层"业务化改写层"**（运行时验证得出的硬要求，见 §5.5-G）：
   - `maskInternalIds` 的职责边界是**只做 ID 掩码与 4 个字段名替换，不改写后端原始措辞**
   - 实例：后端 `该帧槽位没有 file_id：请先上传或生成该帧。` → 掩码后 `该帧槽位没有 文件编号：请先上传或生成该帧。` —— `file_id` 换掉了 ✅，但**「槽位」「接口」两个禁词原样留下**，且整句仍是后端措辞
   - 因此正确的三级顺序是：**① `maskInternalIds`（去 ID）→ ② `sanitizeUserText`（去内部术语句）→ ③ 业务化改写（换成前端中文结论）**；三步都过完仍不干净 → 用 `USER_TEXT_FALLBACK` 兜底，原文只进技术详情
   - `maskInternalIds` 本身的词表扩展见 §7.3
7. **`/api/v1` 的 121 行必须区分两类**（静态扫描共 371 处含 `https?://`，其中 `/api/v1` 121 处）：
   - **`callApi(...)` / `fetch(...)` 调用点 = 正常**（请求代码，不上屏）→ **不改**
   - **文案节点 = 泄漏**（出现在 `message.*`、JSX 文本、`title`/`description`/`placeholder`、Tooltip、拼接给用户看的字符串里）→ 按 §4 清单改
   - 判定方法：只替换「用户能看到的字符串字面量」，源码里作为参数传给请求函数的**不动**
   - 生成物 `services/generated/**` 不手改，只在封装层加屏蔽
8. **主区文案必须是「产品自己写的句子」，不许是「后端句子的改写结果」**（阶段 B 运行时复核得出的硬要求，2026-09-26 新增）：
   - 反面教材（区域 2 实测，静态门禁全绿也照样发生）：交付预览把 `buildUserFacingMessage(delivery.note).title`
     放主区，指望统一管道把后端说明改成中文结论 —— 而 `note` 是**多句长文本**，
     管道只对**已知的那一句**做整句改写，其余原样留下，于是主区上屏
     `本端点只做「仅提示词」出口：导出**来源在白名单内且有正文**的提示词（…）`，
     同时命中模式 2（`端点`/`白名单`）与渲染缺陷（字面 `**`）。
   - **判据**：`toUserFacingText(后端值, …)` 的结果**只允许当兜底/当折叠层原文**；
     主区那一句必须是一个写死的中文常量（或由**枚举映射**产出的名词），
     带注释说明「这是本功能的固定行为说明，不随后端措辞漂移」。
   - **配套断言**：「后端原文进了折叠区」**不等于**「主区干净了」——两者必须**各自有断言**。
     区域 2 的原用例只断言「代码里有 `TechnicalDetailSection`」，所以**看着是过的**；
     新断言直接钉住「主区文案不许是 `{message.title}` 形态」。
   - 每个区域都必须做一次**只读运行时走查 + 宽词表扫描**（§7.4 的表），因为这一类
     **扫描器结构上就看不见**（泄漏是渲后端值，不是写死后端值，§5.6）。

### 7.2 分页提交顺序（按收益/风险比）

| 序 | 页面区域 | 主要工作 | 预估风险 |
|---|---|---|---|
| **0** | **不可用性修复（最高优先，先于一切文案）** | `ProjectWorkbench/index.tsx` 项目不存在分支改渲染「保留 MainLayout 侧边导航 + 返回项目列表」的正常空态页；顺带修 `main.tsx` ErrorBoundary 文案。对标 §5.3 的合规样本（非法章节 ID 已优雅降级） | 中（触及早期 return 路径，但收益是"页面不再完全不可用"） |
| 1 | **管道层**（不是页面） | `services/llmPipelineApi.ts` 4 处错误构造 + `taskActionHelpers.ts:30-44` + `failureText` + `ShotAudioBindingSection` 的 `excluded_reason` 出口 + 新建 `userMessage.ts` | 低（无 UI 变更，但影响面最大，需回归全部 message 出口） |
| 2 | **模式 3 基建** | 新建 `enumLabels.ts` + 单测；迁移 §7.1-4 列出的散落映射；`assetResultSummary.fallbackFailureText` 与 `countsText` 按 §6.3 重写 | 低（纯函数，但 §6.3 的两处**反向锁死测试**需同批改） |
| 3 | 设置 / 模型页 | `/settings` i18n 命名空间修复 + `lng` 初始化（**一行同时修掉 `/settings` 与 404 页**）+ 模型页标签与 `title` 属性中文化 | 低 |
| 4 | 任务中心 / 任务通知 | `GenerationGateBanner.tsx:62`、`taskCopy.ts:198`、`taskCenterMeta.ts` 5 处 ID 兜底、`MainLayout.tsx:99` 面包屑 | 中（任务中心是全站常驻角标） |
| 5 | 项目大厅 | 2 处 tooltip + 排序标签 + 步骤 1 时间格式化 | 低 |
| 6 | 工作台五步 | 步骤 2 警告条、`JuriluScriptGroupPicker`、`ProjectStudioStepPanel`、`assetWriteScope`/`assetGenerationBasis`/`juriluScriptGroups` 文案源 | 中 |
| 7 | 提示词看板 / 资产抽屉 / 待处理抽屉 | `workbenchState.PROFILE_FIELD_LABEL` 与 spec 键对齐、`AssetCardGrid`/`AssetDetailDrawer` 的 `status.reason` 与 `quality.reasons` | 中 |
| 8 | 实体管理 + 镜头/文件/模板/编排/Agent | `AssetEditPageBase.tsx:2316-2328` 结果行 + `:1650` 作用域 Alert + `:2271-2322` 出图结果 Modal（最高危单块）、场景编辑页三处、`LlmPipelinePage`（**待 §9-1 确认可见性**） | 中高 |
| 9 | **ChapterStudio** | 帧/音频区映射、生成区大段技术说明、20+ 处 `message.error(err.message)`、`maskInternalIds` 扩词表 | 高（6600+ 行、改动最需谨慎，**只收文案/加折叠/换映射，不动布局**） |

### 7.3 `maskInternalIds` 扩展项（模式 2 残留）

运行时已证实：`maskInternalIds` 只把 `file_id` 换成「文件编号」，**「槽位」「接口」等禁词原样留下**（R13）。阶段 B 需扩展 `FIELD_NAME_LABELS`：

| 现映射 | 需补充 |
|---|---|
| `file_id → 文件编号` / `storage_key → 存储位置` / `video_prompt_source → 提示词来源` / `shot_details → 镜头记录` | `槽位 → 图片角度`、`接口 → 服务`、`推荐接口 → 推荐结果`、`image_prompts → 图片提示词`、`quality_verdict → 质量判定` |

同时补正则覆盖：`asset_id=`（当前 `KEY_VALUE_RE` 已含）→ 追加 `service_task_id=`、`source_task_id=`、`video_task_id=`、`provider_id=`，以及 UUID 的空格分隔形态。

**同时补"未掩码路径"清单（运行时核对结果）**：以下路径读后端动态文本后**完全没走** `maskInternalIds`，是扩展词表之外的**接线缺口**，必须一并接上：

| 路径 | 状态 |
|---|---|
| `ShotAudioBindingSection.tsx:330,337`（源 `audioAdmissionCore.ts:151` 的 `excluded_reason`） | **0 引用**（运行时观察记作"掩码后直渲"，实为**未掩码**，见 §5.5-F） |
| `assetWorkbenchContract.ts:249-250`（`status.reason`）→ `AssetCardGrid.tsx:158`、`AssetDetailDrawer.tsx:63` | 未接 |
| `assetWorkbenchContract.ts:276-281`（pending review `reason`）→ `PendingReviewDrawer.tsx:64` | 未接 |
| `assetWorkbenchContract.ts:307-317`（`analysis.hint` / `status_label`）→ `WorkbenchCommandBar.tsx:121,173` | 未接 |
| `assetWorkbenchContract.ts:218-224` / `:113-117`（`prompt.quality.reasons`）→ `AssetCardGrid.tsx:162`、`AssetDetailDrawer.tsx:135` | 未接 |
| `assetPromptRequestScope.ts:86`（后端 `message`/`detail`）→ `:158` | 未接 |
| `assetProduction.ts:955`（`task.errorMessage`）→ `:1398`、`AssetProductionArea.tsx:2368` | 未接（同文件 `:1132` 已接，口径不一致） |
| `taskCenterMeta.ts` / `taskCopy.ts` 兜底分支 → `TaskCenter.tsx:414-415` | 未接 |
| `services/**` 全域 | **0 引用**（改在封装层统一接） |

**另需注意 `sanitizeUserText` 强度弱于 `maskInternalIds`**：`userFacingStatus.ts:45-63` 只认固定词表 + `video_task_id\|provider_id\|shot_id\|chapter_id\|project_id` 的**赋值式**，**不认 UUID、`asset_id=`、`storage_key=`、`service_task_id=`、`/api/v1/...`**。两者必须叠加，不能只用其中一个。

---

### 7.4 阶段 B 实际执行状态（2026-09-26 实时更新）

实际执行顺序与 §7.2 的计划顺序不同（按用户拍板「每页独立 commit、逐页确认」推进）；
所有 commit 都在 `pr41-latest`，**已全部推送到 `fork/codex/jellyfish-production-pipeline`**
（fast-forward 到 `89a2512`，Draft PR #41）。

| 批次 | 区域 | commit | 状态 |
|---|---|---|---|
| 序 0 不可用性 | `main.tsx` ErrorBoundary + `ProjectWorkbench/index.tsx` 早期 return（§5.1-R26） | `998c096` | ✅ 完成（提到最前） |
| 序 1 管道层 | `enumLabels.ts`（唯一枚举表）+ `userFacingMessage.ts`（统一 message 出口）+ 技术详情折叠壳合并（§9-2） | `3fecfeb` | ✅ 完成 |
| 序 1b 边界项 | §6.1 任务号下沉 / §6.2 模型业务名 / §6.3 `partial_failed` 口径（含被冻结的期望） | `472a2d3` | ✅ 完成 |
| — | 删页：`ChapterPrep.tsx`（§9-3，先证明不可达再删） | `48f0e55` | ✅ 完成 |
| 区域 1 | §4.1 项目大厅 / 新建向导 + `projectLobbyCopy.test.ts` | `aa9e9ee` | ✅ 完成 |
| 区域 2 | §4.2 工作台五步 + `userFacingCopy.test.ts` 扩充 | `70ff4f1`、`a4488f7` | ✅ 完成 |
| 区域 2 复核 | 运行时复核发现的两条缺陷（交付预览直渲后端长原文 / 来源标签别名） | `16c6cd6` | ✅ 完成 |
| 区域 3 | §4.3 ChapterStudio（`chapter/**` + §4.3 登记的 `shots/components` 两文件）+ `chapterStudioCopy.test.ts` | `b352a2c`、`a2de1c2`、`67b357f`、`a8ee07c`、`351a38f`、`cb8a764`、`64f5324`、`6f1d78d`、`89a2512` | ✅ 完成 |
| **插批** | §5.5-C 资产编辑页批量结果面板（四种模式挤同一行，用户点名提前单独做） | `d94f01f` | ✅ 完成 |
| 区域 3 收尾 | `asset://` / 实际地址下沉 + 成对文案 + 渲染点接线 + 双向断言 | `05166f3`、`5217a9f`、`42bd4da`、`923e2da`、`2ea19d9` | ✅ 完成 |
| 区域 4 | §4.4 任务中心与任务通知（含 R15 任务类型中文、R16 陈旧 `running` 口径）+ `taskCenterCopy.test.ts`（23 条） | `7c342e0` | ✅ 完成 |
| 区域 4 附带 | §4.6-R20 面包屑兜底（`layouts/MainLayout.tsx`） | `971b76c` | ✅ 完成 |
| 区域 5 | §4.5 提示词看板 / 资产详情抽屉 / 待处理抽屉 / `/prompt-flow`（17 条本批改 + 8 条前批已解决）+ 区域 2 护栏扩写 | `3e860a7` | ✅ 完成 |
| 复核收口 | 「本章依据」统一为「本章资料」（批 5 提请的口径不一致） | `a564dae` | ✅ 完成 |
| 区域 7 | §4.7 设置 / 模型页 + **服务层屏蔽层**（含 R24/R27 的 i18n 根因、`title` 属性口径） | `1467a83`、`6309656`、`bf32c66`、`f960895` | ✅ 完成 |
| 区域 6 | §4.6 实体管理 + 镜头 / 编辑器 / 文件 / 模板 / 编排 / Agent（`assets/** shots/** prompts/** agents/** promptFlow/**`；`llmPipeline/**` 按裁定不投工） | `2e7b5bf`、`06b0f89`、`d1636b2`、`fb861fd`、`69a0b99`、`8dbbb32`、`baa176f` | ✅ 完成 |
| 复核收口① | 镜头状态枚举收敛到唯一映射表（`SHOT_STATUS`）+ `maskInternalIds` 补 §7.3 扩展项 | `587264e` | ✅ 完成 |
| 复核收口② | 资产描述里**裸词**字段名（收尾运行时发现，R19 同类） | `38b3980` | ✅ 完成 |

> **阶段 B 全部 7 个区域 + 序 0 不可用性修复 + 插批 §5.5-C 已完成**；
> 剩余为收尾项（§9.6）：R1–R27 复核对表见 **§8.3.1**（20 页只读走查，主区仅 `/models` 一处
> 命中且属**允许**；非 GET 全部为只读 preview）。

**已建立的护栏（§8.1 的落地情况）**：区域 1 `projectLobbyCopy.test.ts`、区域 2 `userFacingCopy.test.ts`（扩充）、
区域 3 `chapterStudioCopy.test.ts` —— 三者都是「目录遍历 + 显式豁免 + 空转自检 + 负向自检 + 扫描面数量守卫 +
渲染点口径专项 + 豁免守卫」结构。区域 4-7 待补。

**运行时只读证据**（1440×900、真实模式、零付费；抓取脚本 `~/Desktop/jellyfish-验收截图/tools/recapture-pages.js`）：

| 证据目录 | 内容 | 结果 |
|---|---|---|
| `after-batch12/` | 区域 1/2 修前 | 步骤 6 第 61 行＝后端原文（`本端点…白名单…`） |
| `after-batch2-fix/` | 区域 1/2 修后 | 该行＝「导出只带「有正文」的提示词…」；各页主区**0 命中**（宽词表，见下） |
| `after-batch3/` | 区域 3 修后 | `studio` 主区 **0 命中**；`来源：jurilu` → `来源：巨日禄导入`、折叠标题 → `内部标识与调用参数（默认收起）`；展开技术详情仍有 `apimart`/`seedance-2.0-mini`/`/api/v1/...` —— **属第三层，合规** |

**宽词表**（运行时复核对静态扫描的补充，必须用）：除 §8.1 的基准表外，还要扫
`端点 / 白名单 / 元信息 / 等价列 / 字段名 / 契约 / 降级视图` 这类**开发术语**，
以及 `pending / partial_failed / external_import / text_only / jurilu / apimart / seedance / deepseek` 这类**渲染出来的后端值**。

> 运行时复核的价值在区域 2 得到证明：**静态门禁全绿（tsc 0 / 507 测试通过 / 扫描 0 命中），
> 主区仍然在渲后端原文** —— 因为「泄漏是渲后端值，不是写死后端值」（§5.6），扫描器看不见。
> 结论：**每个区域都必须做一次只读运行时走查，不能只靠静态扫描。**

---

## 8. 验收方案

### 8.1 逐页补/扩展「主区禁词扫描 0 命中」测试（7 个区域各一）

**先例**：`workbenchState.test.ts` 的 `MAIN_SCREEN_FORBIDDEN_TERMS` / `MAIN_SCREEN_FORBIDDEN_SOURCE_TERMS` 双表口径 + 源码级扫描 + 显式豁免清单。

**阶段 B 要做的是把先例从"硬编码 6 个文件"升级为"目录遍历 + 显式豁免"**：

| 区域 | 测试文件（新建或扩展） | 扫描范围 | 豁免 |
|---|---|---|---|
| 1 项目大厅 | `project/projectLobbyCopy.test.ts` | `project/*.tsx` + `projectStartPresets.ts` + `useProjectStyleOptions.ts` | 无 |
| 2 工作台五步 | 扩展 `ProjectWorkbench/components/userFacingCopy.test.ts` | `ProjectWorkbench/**`（已有） → 词表从 2 词换成完整词表 | 技术详情折叠区内的文件 |
| 3 ChapterStudio | `chapter/chapterStudioCopy.test.ts`（**新建，最高优先级盲区**） | `chapter/**` | `components/*TechnicalDetail*`、`technical` 块所在文件需按行豁免 |
| 4 任务中心 | `components/taskCenterCopy.test.ts`（新建） | `components/task*.ts*`、`generation*.ts*`、`realRunMode*` | 无 |
| 5 提示词看板 / 抽屉 | 扩展 `workbenchState.test.ts:445` 的 `files` 数组 | `workbench/**` 由 6 个文件扩到全目录遍历 | 仅 `TechnicalDetailCollapse.tsx` |
| 6 实体管理 + 其他页 | `assets/assetCopy.test.ts`（新建）+ `shots/shotsCopy.test.ts` | `assets/**`、`shots/**`、`files/**`、`editor/**`、`prompts/**`、`promptFlow/**`、`agents/**` | 无 |
| 7 设置 / 模型 + 服务层 | `models/modelsCopy.test.ts`（新建）+ `services/servicesCopy.test.ts` | `models/**`、`pages/Settings.tsx`、`layouts/**`、`main.tsx`、`services/*.ts`（非 generated） | 供应商/Base URL/AK-SK 输入框所在的**技术配置区块**（白名单到行） |

**禁词表构成（三部分合一）**：
1. **模式 1/2/4 正则**：UUID `[0-9a-f]{8}-…`、`\b(file_id\|storage_key\|task_id\|service_task_id\|source_task_id\|provider_id\|asset_id\|shot_id\|chapter_id\|project_id)\b`、`(/api/v1\|https?://\|localhost\|127\.0\.0\.1\|192\.168\.\|10\.\d+\.)`、`JELLYFISH_[A-Z_]+`
2. **模式 3 枚举原值清单**（**直接 import `enumLabels.ts` 的 key 全集**，保证映射表与测试同源，新增枚举自动纳入）
3. **既有禁词表**：`MAIN_SCREEN_FORBIDDEN_SOURCE_TERMS`(12) + `FORBIDDEN_INTERNAL_TERMS`(11) + `INTERNAL_TOKEN_BLACKLIST`(25)
4. **模式 5**：从 `VIDEO_MODEL_BUSINESS_NAMES` 等映射表的 **key 全集** 生成（模型原名即禁词），避免固定枚举漏掉将来新增的模型

**⚠️ 第 2/3 轮新增的硬要求：扫描范围必须包含 JSX 属性值。**
运行时实测 `/models` 的 `title` 属性里就有完整本机/供应商地址（`title="http://***1:4321/v1"`），**悬停即见**，但纯文本扫描抓不到（源码 `ProvidersTab.tsx:269,539,581`）。因此每个区域的扫描器必须同时覆盖：

| 扫描面 | 覆盖内容 |
|---|---|
| JSX 文本节点 | `>…<` 之间的字面量与表达式插值 |
| **JSX 属性值** | `title=` / `tooltip=` / `placeholder=` / `alt=` / `aria-label=` / `description=` / `message=` / `okText=` |
| 字符串字面量 | 模块级常量、`message.*` 实参、模板串 |
| Tooltip / Modal 配置对象 | `Tooltip title`、`Modal.*` 的 `content`/`title`/`okText` |

并且扫描器自身要有**空转自检**（沿用 `userFacingCopy.test.ts:105-111` 的"扫描器本身有效"用例），否则会出现"文件不存在＝干净"的假绿。

#### 8.1.1 豁免口径的最终裁定（2026-09-26，复核者自主判断，用户已授权）

阶段 B 执行中出现了一个 §8.1 没预见到的问题：**区域 3 的扫描面是 `chapter/**`，
但它的第三层内容物理上就在 `ChapterStudio.tsx` 里**（`part('technical')` /
`part('kf_specs')` 两个折叠块）—— 那个文件 7600+ 行、不可能整文件豁免，
按行号豁免又必然随改动漂移（实测：批 2 记的行号在批 3 开工前已漂移 ~18 行）。

最终裁定（三条，后续批次照此执行）：

1. **组件级豁免只有一个文件**：`project/ProjectWorkbench/components/workbench/TechnicalDetailCollapse.tsx`。
   所有「技术详情 / 原始值」的渲染实现都必须在这里，**别处自建第二套 `<details>` 或
   「技术详情」标签一律判违规**（三个区域测试都有豁免守卫断言这一点）。
2. **`.ts` 生产者文件是「机械豁免」而不是「开口子」**：像 `technicalView.ts`、`assetGenerationBasis.ts`
   这类只生产数据、不渲 JSX 的文件**不在扫描面内**（它们没有 JSX 文本节点可渲）。
   但它们生产的**中文标签也不许在别处手写第二份** —— 中文一律由豁免文件拼（批 2 已按此改过 `technicalView.ts`）。
3. **同文件内的第三层用源码标记圈范围**（新增机制，仅 `ChapterStudio.tsx` 使用）：
   `// >>> 技术详情层开始` … `// <<< 技术详情层结束`。护栏必须同时钉住：
   ① 这两个标记**只在 `ChapterStudio.tsx` 出现**；② `STEP_OPEN_KEYS` **不含 `technical`**（默认收起）；
   ③ `part('kf_specs')` 恰好一次且落在标记区间内；④ **标记区间内不许混入主区内容**
   （不做这条就无法防止「把主区文案挪进标记区蒙混过扫描」）。

**判定理由**：硬编码行号会随本批自己的改动失效（实测已发生），而源码标记
(a) 与被豁免的内容同处一地、改内容的人必然看到它；(b) 可以被测试钉死（标记数量、位置、默认收起状态）；
(c) 不需要「豁免清单」这种外部状态。代价是**多了一种豁免机制**，所以上面的 ①②③④ 四条守卫缺一不可。

### 8.2 `maskInternalIds` 覆盖 + 新模式用例

- **覆盖检查**：新增一条集成测试，断言「所有 `message.*` 的实参在进入组件前都经过 `maskInternalIds` 或 `sanitizeUserText`」——可行做法是对 `pages/**` 做 AST/正则扫描，列出**未包**的调用点并逐条白名单登记（沿用 `userFacingCopy.test.ts:44 OUT_OF_SCOPE_OFFENDERS` 的登记范式）
- **补新模式用例**（现有 4 个用例只覆盖 UUID / `file_id=` / `storage_key=` / 裸字段名）：
  - `service_task_id=svc-1`、`source_task_id=`、`video_task_id=`、`provider_id=` 形态
  - `key=files/a.png`（已有）+ `storage_key=files/` 嵌套形态
  - **新增词表**：`槽位 → 图片角度`、`接口 → 服务`（R13 的残留问题）
  - **不应被误伤**：`画幅 16:9、时长 5 秒`、`文字里有「状态」二字`、`segments`（若产品词表放行）
- **反向断言**（防止过度屏蔽）：`maskInternalIds('本镜已具备生成条件：提示词与参考帧齐全')` 必须原样返回

### 8.3 前后截图对比

- 同批页面（§7.2 的执行顺序逐一）**修改前 / 修改后各截一次**，逐张核对主区无 6 类模式
- 截图基线沿用本次走查的截图（`~/Desktop/jellyfish-验收截图/audit/`，不入库）；第 2/3 轮新增关键基线：`p2_e3_bad_project-1.png`（不存在项目整页报错）、`p2_e5_unknown_route-1.png`（404 英文）、`p2_e1_bad_chapter_studio-1.png`（合规对照样本）
- 重点复核 §5.1 的 **R1–R27 共 27 个可见原文** + §5.5-A~G 的追加条目，逐条确认已消失且**未引入新文案**
- 技术详情折叠区**展开后的内容允许保留**——截图对比只判主区（含收起态的折叠标题）
- **无法只读触发的面板需补实测**：批量出图结果面板（§5.5-B/C）与 `Modal.*` 确认框在本次走查中**未点上屏**，阶段 B 修完后必须在**真实出图**（或明确授权的演练出图）下补一次截图，否则这 8+ 条只有源码证据、拿不到"修好了"的视觉证据
- **新增一条对照用例**：访问不存在的项目 ID（`00000000-0000-0000-0000-000000000000`）应看到「保留侧边导航 + 中文空态」，与 `p2_e1_bad_chapter_studio-1.png`（ChapterStudio 已优雅降级）口径对齐
- **新增一条"悬停态"截图**：`/models` 的供应商地址列 hover 一次，确认 `title` 属性里的完整地址已按 §5.5-D 处理（纯文本扫描抓不到这一类，必须靠截图/悬停验证）

### 8.3.1 阶段 B 完成后对 §5.1 的 R1–R27 逐条复核（2026-09-26）

**方法**：只读脚本 `~/Desktop/jellyfish-验收截图/tools/final-acceptance.cjs` 跑 **20 个页面/面板**，
每页抓 `document.body.innerText` + 1440×900 截图，用**宽词表**（`端点/白名单/元信息/等价列/字段名/契约/降级视图/槽位/供应商/生成依据/内部 ID/任务号/` + 全部内部字段名 + 枚举原值 + 模型与供应商名 + `/api/v1` / `http://` / `127.0.0.1` / `JELLYFISH_` / `SCENE_|PROP_|CHAR_` …）
扫主区全文，并对 R1–R27 的**「修前原文」**做逐条探针。

**结果**：20 页里**只有 `/models` 一处命中**（`供应商 / apimart / http://`）——
按 §4.7 与 §9.1-26 的判定属**允许**（配置页的核心功能 + 掩码后的本机地址已标注「仅本机可达」）。
其余 19 页主区 **0 命中**。非 GET 请求 **4 条，全部是只读 preview POST**（页面加载自动发出）；
**写请求 0、付费调用 0**。第一轮跑用固定 7s 等待时曾把「还在加载」误判成降级页（步骤 2 出现
「本章资产资料还在准备中」），改为等 `networkidle` 后复跑即恢复正常 —— **这是抓取脚本的问题，不是产品问题**。

| # | 修前原文 | 结论 | 证据 |
|---|---|---|---|
| R1 | `排序 createdAt ↓` | ✅ 已修 | 运行时「排序 / 创建时间 / 新→旧」 |
| R2 | 项目名「孤立项目 `script_9c3aafd08a`（迁移）」 | ✅ 前端兜底已修；**数据侧改名仍待办**（§9.6） | 运行时显示「未命名项目（迁移）」 |
| R3 | 更新时间直渲 ISO（×2） | ✅ 已修（`userFacingTime` 唯一实现） | 探针 `T04:02` 命中 0 |
| R4 | 「等待后端契约」「降级视图」大警告条 | ✅ 已修（含重试入口） | 探针 0 命中；加载完成后正常态 |
| R5 | 批量导入表头「脚本组（`script_id`）」 | ✅ 已修 | 探针 `script_id` 0 命中 |
| R6 | `external_import` / `imported_size … 没有等价列` | ✅ 已修（`16c6cd6` 去掉后端长原文） | 探针 0 命中；运行时为「导出只带「有正文」的提示词…」 |
| R7 | `未通过 · extraction_ready` 等整排检查码 | ✅ 已修（未登记项整行隐藏） | studio 主区探针 0 命中 |
| R8 | 「当前按 `text_only` 参考模式检查」 | ✅ 已修 | 探针 0 命中 |
| R9 | 「为什么仍然是 `pending`」 | ✅ 已修 | — |
| R10 | 「要求的帧：`first`」 | ✅ 已修（过 `frameTypeLabel`） | — |
| R11 | 声音绑定段含 `seedance` / `audio_urls` / `asset://` / `/files/…` / 仓库文件名 | ✅ 已修（协议细节只留注释；地址进折叠层） | 批 3 收尾运行时：主区地址命中 0 |
| R12 | `**输入**` 字面星号 | ✅ 已修（改 JSX 强调，去 markdown 记号） | 探针 0 命中 |
| R13 | 掩码后仍留「槽位」「接口」 | ✅ 已修（`maskInternalIds` 扩中文词表 `6f1d78d`） | 区域 3 护栏「整条管道出口不含 槽位/接口/`file_id`」 |
| R14 | 技术详情收起态标签正文含「供应商、内部 ID、`file_id` / `storage_key`、接口参数」 | ✅ 已修 | 运行时「内部标识与调用参数（默认收起）」 |
| R15 | 任务类型英文原值 `video` | ✅ 已修（未登记→「后台任务」） | 运行时「视频生成」 |
| R16 | 陈旧 `running` 却显示「耗时 2492 小时」 | ✅ 已修（「状态未知（超过 6 小时未更新）」+最后更新时间+建议动作；**没造不存在的失效按钮**） | 任务中心面板实测 |
| R17 | 资产资料行标签中英混杂 `relations` / `related_plot` / `shot_refs` | ✅ 已修（改为**消费** `ASSET_PROFILE_FIELD_SPECS`，14 个真实键都有中文） | 区域 5 护栏逐个键断言 |
| R18 | 「高级选项（Authorization / Referer / API 覆盖 / 写入开关）」 | ✅ 已修 | 运行时「登录凭证 / 来源页 / 接口地址覆盖 / 是否写回」 |
| R19 | 描述直渲 `segments、shots、…` | ✅ 已修（展示层转述 + 原文进折叠层） | 见下方「收尾追加」 |
| R20 | 面包屑含 percent-encoded ID 与英文段 `scenes` | ✅ 已修（`971b76c`） | 运行时「详情」 |
| R21 | 标题 `SCENE_星耀疗养院S级特护病房门外` | ✅ 展示层剥离（数据侧改名待办）；原名进技术详情 | 运行时主区「暗巷地下诊所内外」，展开可见 `SCENE_…` |
| R22 | 「资产类型：`scene` 项目作用域：未识别」 | ✅ 已修（中文映射 + 不回显编号） | 探针 0 命中 |
| R23 | 「照片角度：正面 **ID 23**」 | ✅ 已修（→「已出图」，编号进技术详情） | 探针 0 命中 |
| R24 | `/settings` 整页 i18n key / `Save` | ✅ 已修（i18n 根因，一行同时修 R27） | 运行时整页中文 |
| R25 | `/models` 的 `Base URL` / `AK/SK` / `title` 全地址 / 本机地址 | 🟡 **按设计部分保留**：标签改中文在前英文括注、**悬停与可见同口径**、本机地址标注「仅本机可达」；供应商名与模型名是配置页的操作对象故保留 | 运行时：悬停给出完整地址的单元格 **0**；实现细节收起态 0 命中、展开可查 |
| R26 | 不存在项目 ID → 整页框架报错、侧边导航消失 | ✅ 已修（`998c096`）：正常空态「项目不存在或已被删除 / 返回项目列表」+ **侧边导航保留** | 运行时实测（导航 8 项仍在） |
| R27 | 未知路由整页英文 | ✅ 已修（与 R24 同根因） | 运行时「页面不存在 / 抱歉，您访问的页面不存在。/ 返回首页」 |

**收尾追加（本轮运行时又抓到并已修）**：R19 同类还有一处漏网 ——
`/assets?tab=scene` 主区残留 `上下文判断来自segments和shots中…`（后端自动描述里的**裸词**字段名，
原识别逻辑只认反引号与 `snake_case` 两种形态）。已修（`38b3980`）：裸词匹配只对**已登记**字段名生效、
且要求**至少一侧紧邻中文**，因此 `wide shot` 这类英文提示词**不会被改坏**（有反向断言钉住）。
复跑后该页 `segments` 命中 **0**，实际渲染为「上下文判断来自出场片段和镜头中…」。

### 8.4 门禁命令

```
pnpm exec tsc --noEmit      # 类型必须过
pnpm test                   # 单测必须过（含新增的禁词扫描与 enumLabels 用例）
pnpm lint                   # 不新增 lint 错误（既有 11 条存量不算）
```

- 若 §8.1 的枚举清单测试因 `enumLabels.ts` 新增 key 而变红，属**预期行为**，需同步补映射而不是放宽测试
- §4 里标注 ⚠️ 的 4 处**反向锁死测试**（`generationStatusCore.test.ts:52`、`audioAdmissionCore.test.ts:39,59,134`、`assetPromptSlots.test.ts:117,210`、`workbenchState.test.ts:391`）在对应页面 commit 里**必须同批修改**，否则会被误读为回归
- **第 2/3 轮新增第 5 处反向锁死**：`assetResultSummary.ts:72` 的注释「原始 status / outcome 文本（原样展示，让用户看到 partial_failed 这种真话）」是**有意为之的设计声明**，与 §6.3 新口径直接冲突；改实现时必须同批改注释，否则会被下一个人照注释改回来

---

## 9. 待用户确认项

### 9.0 拍板结果（2026-09-26）

下列 5 项**已由用户拍板**，阶段 B 已按此执行；原文保留在 9.1-9.5 以便追溯：

| 项 | 用户裁定 | 执行情况 |
|---|---|---|
| 1 `llmPipeline` 可见性 | **按「仅开发可见」整批降级**，相关条目标记即可；阶段 B 不在该页投工（后续追加：主入口在导航里淡化，本轮不改路由） | 已按此跳过该页；导航淡化仍未做（见 9.6） |
| 2 `ProjectDevInfo` 技术详情 | **并入** `TechnicalDetailCollapse.tsx`（唯一豁免文件） | `3fecfeb` + 批 2 `a4488f7` 完成 |
| 3 `ChapterPrep.tsx` | **同意删页** | `48f0e55`（先证明不可达再删） |
| 4 顶层 ErrorBoundary | **采用**「页面出错了，请刷新重试」+ 原文折叠 | `998c096`（提到序 0） |
| 5 分镜页「候选」 | **按细分口径**：禁「候选条数 / 聚合 N 组 / 候选 id / `candidate_status`」，放行「待确认候选」 | 批 1/批 2 按此执行，并有负向自检防过度整改 |

### 9.1 阶段 B 执行中新出现的判定（复核者判断，用户已授权自主处理）

1. **外部工具「巨日禄」的显示名 —— 不算供应商泄漏，全站统一用「巨日禄导入」。**
   依据：它是本项目**导入剧本的外部工具名**（导航、页签、抓取面板、审计 §4.5 的建议口径都在用），
   不是模型供应商；审计要求替换的是**枚举原名 `jurilu`**，不是这个工具名。
   执行中发现过两种自创别名（批 2 的「巨量导入」、批 3 的「剧立方导入」），均已改回；
   同类问题再犯即属回归（已加护栏：名称在源码里只允许出现一种形态）。
2. **工作台步骤 3 的「章节 ID 末段」（`当前目标章节：名称｜ID …204035`）—— 判定不是泄漏，保留。**
   依据：① 审计在**同一个文件**里点名了 `script_id`（`:213,319`）却**没有**点名它，
   说明阶段 A 已把它判为「有意的同名章节消歧手段」；② 它是 6 字符末段、不是完整 UUID，
   也不是任务号/资产号（§6.1 管的是任务号）；③ 主区已同时显示「第 N 集」，
   但**同名分集**确实只能靠末段区分，去掉会造成真实的误选风险。
   **代价**：它是主区唯一保留的内部标识片段，若用户日后要求彻底清零，改 1 处文案 + 4 条断言。
3. **`（Mock）` 占位文案（`ChapterStudio.tsx` 11 处）—— 本轮不改，登记为独立小任务。**
   依据：不在 §4.3 的 63 条内、不属 6 类模式；单去掉 `（Mock）` 等于向用户**谎报**操作已完成，
   正确修法是禁用/移除这些占位按钮或标注「暂未开放」，属**产品交互改动**，不应混进文案批的 hunk。
4. **`assets/**` 结果面板里的 `asset://` 与「本次请求携带的地址：https://…」—— 授权下沉。**
   依据：审计 §3.4 把「文案里的存储形态 / 完整地址」记为模式 4 出口；
   `audioAdmissionCore.test.ts:39,59,134` 被冻结的期望属「钉住旧行为」，按既有授权可同步更新
   （**改成更强**的断言：主区不含地址、地址出现在技术详情）。
5. **`后端` 二字保留、`最终提示词 → 提交版本` 不再全局统一** —— 二者都不在基准禁词表、审计也没点名，
   只在「本来就在改」的句子里顺手换用户语言，避免为避一个词做全站 sweep（§7.1 反过度整改）。
6. **「地址」不进通用掩码管道（`maskInternalIds` / `userFacingMessage` 的通用规则）—— 保持逐出口产品化收口。**
   依据：地址既是**文案**也可能是**动作目标**（`href` / `window.open` / `<img src>`；「打开图片」这类入口必须留），
   在通用管道里做地址屏蔽会误伤并把口径搞模糊；审计 §3.4 本来也是**按出口**登记的。
7. **`blocked_reason`（生成视频按钮禁用那条 Alert）保留现状，不改。**
   依据：`参考模式「首帧」的参考帧不可用：缺少参考帧：首帧` 具体、可读、全中文，**不含 6 类模式里的任何一类**；
   §7.1-8 针对的是「多句后端长文本改写后仍藏内部词」（区域 2 的交付说明），不是这种短句。
8. **`readTechnicalDetails()` 的内存日志不新建全局 UI**：
   上屏需要新增订阅/状态（模块级数组不触发 React 重渲染），属结构改动、收益低于成本。
   替代口径：**每个「后端原文」出口就地用一个 `TechnicalDetailSection` 承载原文**
   （批 3 收尾已按此补 `keyframe-plan-warning-detail` / `video-pinned-plan-warning-detail` / `request-audit-detail`，
   并补齐 `provider_notes` 与 ⑥ 生成视频两处的屏幕出口）。
   **判定「成对文案」是否成立只看一件事：原文在**屏幕上的默认收起层里**能查到** —— 只写进内存日志不算。
9. **导航名「LLM 调试台（开发）」不改名**（区域 4 提请）。
   依据：用户已裁定该页「仅开发可见、阶段 B 不投工」，改名属**产品命名决策**，不在治理范围；
   代价是 `layouts/MainLayout.tsx` 只能做**定点断言**、不进区域扫描面
   （把它拉进扫描面就必须整文件豁免，正是 §8.1.1 禁止的）。
10. **不新建后端接口**（区域 4 提请的「标记为已失效」）：本阶段**不改 `backend/` 一行**是硬边界；
    前端按「如实说明 + 可用动作（取消）」处理，接口需求登记为后续建议（见 9.6）。
11. **陈旧任务阈值取 6 小时、判据 `updated_at_ts`，接受**（区域 4 提请）：
    后果之一是**21 条 265 小时前创建、从未推进的 `pending` 审计任务现在显示「状态未知（超过 6 小时未更新）」**
    而不是「排队中」—— 判定这**更诚实**（它们不会再跑），但承认这是**可见观感变化**。
    代价：真在跑、6 小时无进度变更的长任务会被误判 → 建议后端加心跳（登记 9.6）。
12. **演练模式的分步命令整体默认收起**：接受（审计要求「整段收进技术详情」）；
    主区只留「改完配置并重启后端进程，角标回到真实模式即为成功」。
13. **后端 `startup_warning` 原文照原样收在折叠层**（含 `!!!!!!` 边框与环境变量名）：
    不改内容（技术层要求**忠实原文**），只保证它不在主区；建议后端自行精简（登记 9.6）。
14. **`shotStatusText.ts` 的机械替换痕迹要顺过来**（我在运行时发现的文案回归）：
    `472a2d3`（**序 1b「边界项」批次**：任务号下沉 / 模型方案名业务化 / `partial_failed` 口径）
    在同一次机械替换里把 `label: '待确认资产候选'` → `'待确认提取到的资产'`（**正确**）、
    把 `nextAction: '去确认提取候选（…）'` → `'去确认待提取到的资产（…）'`（**多带了一个「待」**），
    后者读不通（「待提取」会被读成「还没提取」）且与 `label` 语义打架，**它在每张分镜卡上都上屏**。
    口径：「候选」的**细分替换要按整句语义重写，不许逐词替换**。已由批 3 收尾修正为
    `去确认剧本里提取到的资产（关联已有资产或新建）`，并把期望改成**更强**的断言
    （同时断言不许再出现 `/待提取/` 与 `/待确认待/`）。
    > 出处订正：本文件先前把成因记为 `70ff4f1`（第 2 批），经 `git log -S` 核实**是错的** ——
    > 第 2 批没碰过该文件。**台账出处必须用 `git log -S` 核实，不能凭印象写**。
15. **`PendingReviewDrawer` 采用「主区产品结论 + 原文进折叠层」，不按审计字面口径（掩码后留主区）**（区域 5 提请）。
    依据：`row.reason` 是后端句子；主区那句由 `kind` 映射成**可行动的结论**
    （「名称和已有资产对不上：请确认用哪个名字」等 4 种），原文一键可达。
16. **「只断言主区干净」必须配「原文确实在折叠层里」的断言**（区域 3 收尾实施，全面推广）：
    新增 `assertRenderedOnlyInsideTechnicalDetail(source, token, testId)` —— **块内必须命中 + 块外 0 命中**。
    理由：只断言主区干净会**放过「直接删掉信息」**这种假修；§7.1-8 的「成对」要双向可验证。
17. **⑥ 生成视频的 warnings 保留两处默认收起的原文出口**（区域 3 收尾提请去重）：
    ① 新增的就地 `video-plan-warning-detail`（贴着产品结论句，用户在哪里看到结论就在哪里展开）；
    ② 既有的「后端原始提示」（在审计判「勿动」的技术层标记区间内，**不许动它**）。
    判定：两处都默认收起，重复的是**原文**而不是主区噪音，去掉任何一处都会牺牲一个真实用途（就地排查 vs 集中排查）。
18. **`TechnicalDetailCollapse.tsx` 里 `hint` 的「候选条数 / 聚合组 / 字段名 / 模型 / 供应商 / 任务号」这一串词保留**
    （区域 5 提请）：它在**唯一豁免文件**内，且运行时实测**收起态 0 命中**（在 `<details>` 里）。
    这属豁免文件自身的文案风格问题，不是主区泄漏；要改是单独的产品文案决策。
19. **`assetGenerationBasis` 的「本章依据」其余 5 处统一改为「本章资料」**（区域 5 提请，已执行 `a564dae`）：
    同一块面板里摘要说「本章资料」、行标签说「剧本依据」= 用户在同一屏看到两个名字指同一件事。
    收口原则：**同一份数据在全仓只允许一个名字**（同 9.1-1 的别名漂移）。
20. **区域 6 待办（区域 5 移交）**：`assets/components/assetProfileFields.ts` 的 `profileFieldLabel` 兜底、
    `PromptFlowPage.tsx` 的非 §4.5 残留（`:313/:317` 章节无标题回落 UUID、`:1488` skill 编号拼 title、
    `:575` placeholder 带 `?projectId=&clipId=`、`:197` 一线 20 处 `describeError` 直上 toast、
    `:979/:1510` 的 `renderEnvelope` 展开 `meta.diagnostics`）—— 全部并入区域 6 任务书。
21. **「清理过度整改」的口径（区域 5 的实战发现）**：「未知值不回显英文」是对的，但**不许顺手把该字段的信息也丢掉**。
    实例：批 2 把 `profileFieldLabel` 的兜底从 `?? key` 改成「其他资料项」时，**14 个真实后端键的标签全丢了**
    （`relations` / `related_plot` / `shot_refs` … 全显示「其他资料项」）；批 5 改成**消费**
    `ASSET_PROFILE_FIELD_SPECS` 生成标签表才补回来。**判据：兜底只兜「未登记」，不能兜掉「已登记」**。
22. **`assets/**` 那 6 处动态插值渲染点交给区域 6 收**（插批 `d94f01f` 提请）：
    工具栏「资产类型：`scene`」「项目作用域：`<UUID>`」、角度卡片「`ID 23`」、备选图「`图片 N`」、
    资产标题旁 `{asset.id}` 与 `SCENE_` 前缀 —— 正确修法要**接项目名 / 给卡片加第三层位**，属信息结构改动，
    所以插批没做，而是**把它们逐条登记进护栏并上锁**（`assetCopy.test.ts` 有一条「未处理渲染点登记」用例，
    保证不许悄悄增加）。已随区域 6 任务书移交，并要求**同步收缩那条登记**。
    > 这条「**把已知未修的点登记上锁**」是插批最值得保留的做法：既如实承认没做完，又让「以后悄悄变多」立刻失败。
23. **后端报错原文进第三层，不新造「依据层」壳**（插批提请 §5.5-B4）：
    第二层（折叠依据层）的语义是「中文的凭什么」，**不是原文堆放处**；原文用 `TechnicalDetailSection` 承载即可。
24. **i18n 的初始语言口径（区域 7 落地，R24/R27 的同一个根因）**：
    `lng: resolveInitialLanguage()` —— **先读 `localStorage['jellyfish_language']`，没有就默认 `zh-CN`**；
    **不许写死 `'zh-CN'`**（那会让用户的语言选择失效），也不许删 `fallbackLng`；`LanguageDetector` 保留
    （它负责把用户之后的选择写进 localStorage）。
    运行时三场景实测（`navigator.language = en-US`，正是本缺陷的触发条件）：
    ① 无存储选择 → **中文**；② 存过 `en-US` → **英文**；③ 存过 `zh-CN` → 中文。
    **这一条的意义超出本缺陷**：它同时修掉 `/settings` 整页 i18n key 与 404 整页英文，
    而修法是「让默认语言正确 + 尊重显式选择」，不是「把某一页的文案硬翻一遍」。
25. **生成客户端 `ApiError.message` 不就地掩码，封装层只读出口目前无调用点（登记为缺口）**（区域 7 提请）：
    就地掩码会让 `generationStatusCore.readErrorCode` / `realRunModeCore.readEnvelope` **无法再从
    `message` 里的 `body: {…}` JSON 解析出「演练模式拦截」**，那是**功能性回归**、不只是文案问题。
    故改为提供 `toUserFacingApiErrorText()` / `technicalTextOf()` 供页面侧使用（**不改传入对象**）。
    **如实结论：这条路径尚未闭环**（见 9.6）。
26. **模型管理页保留供应商名 / 模型名 / `PROVIDER_STATUS_MAP` 本页说法**（区域 7 提请）：
    该页是**配置页**，供应商与模型是它的操作对象（审计 §4.7 原文「标签保留（供应商配置页允许技术性最强）」）；
    §6.2 的业务化口径针对的是**生成页**。状态词双口径（本页「活跃/禁用」vs `enumLabels` 的「可用/已停用」）
    **只登记不统一**（统一属「为口径做 sweep」），已用断言把差异钉住、不许静默漂移。
27. **共享扫描器的一个假阳性登记待修**（区域 7 发现）：`FRAME_TYPE` 的枚举原值 `key` 会命中
    审计**允许**的英文括注「访问密钥（API Key）」——所以模型页有 3 处「预期命中」被登记为豁免。
    判定：这是**扫描器的假阳性**（大小写不敏感 + 整词匹配把 `Key` 也算上了），
    修法是「**全小写的枚举原值按大小写敏感匹配**」（后端的原值本身就是小写）。
    因为该文件是全区域的共享扫描器、而区域 6 当时正在使用它，**本轮不动**，登记为收尾项（见 9.6）。

### 9.6 仍未处理 / 仍未验证（诚实清单）

- **`（Mock）` 占位按钮**（9.1-3）：待用户决定是否开一条「占位功能可见性」任务。
- **`llmPipeline` 导航入口淡化**（9.0-1 的追加项）：本轮不动路由，未做。
- **`services/**` 屏蔽层**（§7.2 序 1 的下半）：仍为 0 引用，未建（改在调用点接管道）。
- **§8.3 要求「无法只读触发的面板需补实测」**：批量出图结果面板（§5.5-B）、
  `Modal.*` 确认框（§5.5-C）、展开「技术详情」后的交付原文 —— 仍未在真实/演练出图下取到视觉证据。
- **`partial_failed` 的运行时回读**：§6.3 的新口径只在字符串级与单测级验证。
- **「地址确实落在技术详情层」只有单测级证据**：批 3 收尾的运行时证据只证明了**主区 0 命中**
  （`~/Desktop/jellyfish-验收截图/after-batch3-followup/studio-step5-main.txt` 地址命中 0），
  但同一目录 `studio-step5-technical-layer-only.txt` 的地址命中也是 **0** —— 因为该镜当前没有绑定声音、
  没有地址数据可查，且 `ShotAudioBindingSection.tsx` 的接线当时还没做（已补，见 9.1-8）。
  **结论**：不要把「地址已收进折叠层」写成已实测，它当时的证据是**单测级**。
- **`ShotReadiness.missing` 是结构性收口**：该字段当前**没有任何渲染点**，
  它的 `technicalDetails` 只在字段旁留了注释提醒；将来谁渲染 `missing`，必须一并渲染 `technicalDetails`。
- **后端侧建议（本阶段不改后端，仅登记）**：① 任务表加「标记为已失效」写接口（现在只有 `cancel` 与
  `task-links/adopt`，所以陈旧任务只能给「取消」）；② 任务表加心跳字段，让「陈旧」判据不依赖 `updated_at`；
  ③ 精简 `startup_warning` 的 `!!!!!!` 边框与环境变量清单。
- **批量出图结果面板（§5.5-B/§5.5-C）仍然只有源码级证据**：本项目出图 0 张，该 Modal 只有点
  「批量生成选中项」才会出现（**付费 + 写库**动作，未做）。插批的运行时走查覆盖的是**场景编辑页主区**
  （`~/Desktop/jellyfish-验收截图/after-5.5c/`，非 GET / 非 preview 请求 **0 个**），
  实拍当时仍能看见 2 处**已登记**的 §4.6 模式 1 泄漏（「资产类型：`scene`」「`ID 23`」）→ 已移交区域 6。
- **`assets/**` 的 6 处动态插值渲染点**：插批已在护栏里逐条登记上锁（见 9.1-22），本身未修。
- **生成客户端的 `ApiError.message` 仍未掩码**（见 9.1-25）：`services/generated/core/request.ts:281` 会把
  「完整响应体 JSON」拼进 `message`；封装层只读出口 `toUserFacingApiErrorText()` **目前没有调用点**。
  影响面：凡**直接**渲染该 `message` 而又没接管道的地方仍可能带出 UUID 等原文。
  **闭环做法（建议）**：在封装层给错误对象补一个 `rawMessage` / `bodyText` **独立字段**，
  让 `readErrorCode` / `readEnvelope` 改读该字段，`message` 就可以安全掩码 —— 这要动到批 4 的两个文件，
  属跨区域小改动，未在本轮做。
- **共享扫描器的 `key` 假阳性**（见 9.1-27）：模型页现有 3 处「预期命中」豁免；修法是
  「全小写枚举原值按大小写敏感匹配」，需在区域 6 收工后改并重跑全部区域护栏。
- **`guard_status` 三种取值**：只在字符串级验证，未在真实后端响应上回读。
- **`toUserFacingText` 整句丢弃规则对真实 `provider_notes` / `frame_block_reasons` 的影响**：见 9.1-4 的收尾批。

### 9.7 阶段 A 原始开放项（保留原文，便于追溯）

以下 5 项为本次审计中的开放问题，**未拍板前不应作为阶段 B 的改动依据**：

1. **`llmPipeline/LlmPipelinePage.tsx` 是否只对开发开放？**
   现状：该页 `:1354` 自声明「这是开发调试工具，不是正常用户的生产入口」，页面标题「LLM 编排调试台」，`MainLayout.tsx:61` 标注「LLM 调试台（开发）」。
   **其中第 1 项若确认只对开发可见，该页 30+ 条可整批降级**（§4.6 与 §7.2 序 8 中该页所有条目均随之降级）。
   若菜单里所有用户都能点进去，则它是**全仓最大的单一泄漏面**（表格整片是 `service_task_id` / `oss_url` / `generation_type` / `enum_code`）。

2. **`ProjectDevInfo.tsx` 这套「第二技术详情」是否并入 `TechnicalDetailCollapse.tsx`？**
   现状：共 3 处自建折叠区（`ProjectDevInfo.tsx:179`、`AssetImagePromptLlmPanel.tsx:947/1005`、`AssetProductionArea.tsx:2718/2761`），而唯一豁免组件只有一个。测试只能给一个文件开口子；多套实现等于豁免范围失控。建议合并。

3. **`ChapterPrep.tsx` 是否直接删页？**
   现状：42 处 `（Mock）` 用户可见文案，但**当前不可达**（`App.tsx:36,40` 已把 `prep/*` 与 `prep-drafts` 重定向到 `../shots`）。翻译 42 处 Mock 文案是纯浪费，建议删页。

4. **顶层 ErrorBoundary（`main.tsx:46-49`）的口径？**
   现状：把原始 `error.message` 整屏 `<pre>` 输出，是唯一一处「主页级」泄漏。建议改「页面出错了，请刷新重试」+ 原文进默认收起的折叠区（改造成本极低）。

5. **分镜页（`shots/**`）30+ 处「候选」是否全改？**
   现状：「候选」在分镜页被大量用作业务术语（`ChapterShotEditPage.tsx:97,103,104,111,168,853,909,1133,1232,1255-1285,1377,1415`、`ChapterShotAssetConfirmation.tsx:65,75,77,79,80,199,204,226,231`、`ChapterShotDialogueConfirmation.tsx:57,66,68,70,106`、`ChapterShotAssetBindingSection.tsx:508,526,544`）。
   **禁词细分建议**：把「候选」拆成两类——**禁**「候选条数 / 聚合 N 组 / 候选 id / candidate_status」这类后端概念；**放行**「待确认候选」这类业务说法（用户能懂，且是产品术语）。否则会出现"为避开一个词改 30 处文案"的过度整改。

---

*本文件为阶段 A 的唯一交付物。审计过程全程只读：未修改任何产品代码、未 commit、未 push、未运行前端服务、未发出付费请求。*
