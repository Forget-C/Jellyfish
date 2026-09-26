---
title: "广告剧情流程 MVP（快速跑通版）需求"
description: "用户拍板「广告流程要迅速跑通」后的 MVP 执行版：在 DramaPlan 全量方案基础上砍掉出图通道、起点枚举与工作台平权，最小链路跑通「卖点 → 剧情方案 → 确认 → 章节/分镜/资产 → 既有五步」"
weight: 10
---

> 本文是**执行版需求**，供执行 AI 直接开工。
> 全量设计见 [商品剧情策划（DramaPlan）接入方案](/docs/plans/product-drama-plan-integration/)（下称「全量方案」），
> 两者冲突时**范围以本文为准**（本文更窄），设计口径以全量方案为准（本文不复述）。
> 落地后把生效规则沉淀到 `architecture`，本文收口。

## 背景与目标

用户 2026-09-26 拍板三大需求的优先级：①主流程修问题（另行汇总）②**广告流程迅速跑通（本文）**
③前台技术信息泄漏治理（见 [前台技术信息泄漏治理需求](/docs/plans/frontend-tech-info-layering/)）。

「迅速跑通」= 最短链路验证商业价值：**填商品卖点 → 一次模型调用出剧情方案 → 人工编辑 →
显式确认 → 落成正式章节/分镜/资产 → 既有五步流程（资产准备 → 提示词 → 绑定 → 生成）直接接着用**。
不是把全量方案一次做完。

## MVP 范围 vs 后置（砍法）

| 全量方案内容 | MVP 处理 | 后置批次 |
|---|---|---|
| 商品自建 APIMart 出图通道（对标 `750148e`，本批最大单块） | **砍掉**。商品图走「本地上传 + 绑定定版」：`POST /files` 上传（`app/api/v1/routes/studio/files.py:131` 已存在）+ 新增一个小端点把 file_id 落成 `product_images` 行 | 通道批 |
| `start_mode='drama'` 第三种起点 + 创建向导 DramaBrief 屏 | **砍掉**。不动 `ProjectStartMode`、不动 `resolveProjectStep` 判定链（高危）、不动向导。入口 = 项目内新面板页「剧情策划」（照 `0785e0e` 先例加一页） | 入口批 |
| 工作台第五页签「商品」+ 批量区计数 | **砍掉**。商品不进工作台四类平权；确认后角色/场景/道具照常进既有工作台，商品只参与帧参考 | 工作台批 |
| 出图侧类型枚举（`STRATEGIES` / `channel_submit` / `asset_prompt_batch` / `image_tasks` / `asset_workbench` / `asset_strategies.SUPPORTED_ASSET_TYPES`） | **后置**。MVP 商品不产生图任务 | 通道批 |
| 读取侧类型枚举（实体 CRUD / 分镜关联 / 帧参考解析 / 绑定与采纳） | **MVP 必须做**，否则商品定版图取不到、关联建不了 | — |
| DramaBrief → DramaPlan 编排 + 草稿 + 确认 materialize | **MVP 核心，全做** | — |
| 迁移 | products 三表 + 草稿表**一批迁移**做完 | — |

砍完后枚举点从全量的约 120 处缩到约 40 处，且不碰判定链与向导这两个高危区。

## 关键设计决定（已拍板 + 本文新增）

**沿用已拍板七条**（详见全量方案「待拍板清单」的决议记录）：

1. 剧情策划最终是第三种起点，但 MVP 不做起点（见上表）；最终形态不变。
2. 草稿按章节一份（`chapter_id` 唯一，`project_id` 冗余便于按项目查，索引照 `shot_video_prompt_drafts`）。
3. 首发**一次调用** + 返工按段重生成；`DEFAULT_MAX_TOKENS = 4096`
   （`app/services/studio/llm_orchestration/client.py:27`）对长 JSON 偏小，**开工前必须把所用
   Model 行的 `params.max_tokens` 调到 ≥ 8192**（`client.py:142-153` 按行覆盖）；截断是主要失败形态，
   编排层没有模型重试、没有主备模型。
4. 商品由用户在 DramaBrief 显式填写，**不进**实体提取白名单（`registry.py:18` 保持 3 类）；
   照 costume 先例加 `ENTITY_TYPE_REJECT_HINTS["product"]`（`registry.py:53`）。
5. 商品图通道照 costume 自建——**本 MVP 后置**，见上表。
6. 商品是**全局资产**（表里不放 `project_id`），归属靠 `project_product_links` 三档作用域；
   `uq_products_name` 全局唯一，撞名靠品牌前缀（商品只来自用户手填 brief，撞名频率低）。
7. 最终入口在创建向导——**本 MVP 后置**，见上表。

**本文新增三条（MVP 才能成立的补丁，均已核实代码）**：

8. **挂点顺序**：向导不改，因此项目内面板页负责整个生命周期——
   `PUT brief`（**免费**：保存 brief；若项目里还没有可用空章节则自动建一个空章节，标题取商品名）→
   用户显式点「生成剧情方案」（**付费**，走租约）→ 草稿落 `drama_plan_drafts` → 编辑 →
   `POST confirm` materialize。**绝不在保存 brief 时触发模型调用**。
9. **materialize 不能复用 `_append_division_rows`**（已核实 `app/services/studio/script_division.py:14-44`）：
   它把 camera 硬编码为 `ms/eye_level/static`、`duration` 硬编码 4 秒，且**不写对白独立表
   `shot_dialog_lines`**。必须新写 `app/services/studio/drama_plan_materialize.py`：
   按方案逐镜写 `Shot` + `ShotDetail`（真实景别/机位/运镜/时长/动作拍点）+ 对白行 +
   角色/场景/商品资产与关联行，一个事务落库。可复用它的「章节已有镜头则拒绝写入」口径。
10. **商品外观只走帧参考图，不进文本提示词**（口径写死，防止后续重复设计）：
    商品定版图经 `reference_resolver`（`app/services/studio/image_pipeline/reference_resolver.py:31,38`，
    **必须**加商品映射，否则取不到定版图）进 `frame_submit` 的 `reference_file_ids` /
    `reference_labels`；不得把商品图直接塞进视频请求（`build_context.validate_images_count` 会 400）。

## 数据模型（四张新表，一批迁移）

照全量方案「影响面 §1」的字段清单，不重复；补充草稿表形状（照 `shot_video_prompt_drafts`，
模型在 `app/models/studio_shots.py:271-358`）：

- `drama_plan_drafts`：`chapter_id` String(64) FK **主键**（一章一份）+ `project_id` String(64) 冗余索引 +
  `brief` JSON（用户输入，保存即写，免费）+ `plan` JSON（模型产物归一化后的草稿，**只有生成成功才写**）+
  `status` String(16)（`running/ok/failed`；**空串 = 未生成**，因为 brief 行可能已存在但还没生成过——
  这是对「未开始不落行」先例的唯一有意偏离：行由免费的 brief 保存创建，付费状态由 status 表达）+
  `error` / `model` / `meta` JSON / `claim_token` / `claim_expires_at`（租约，防重复付费）。
- 人工编辑直接改 `plan` JSON 草稿列；**确认前不落任何正式行**（项目/章节/资产/分镜只有一套正式产物）。

**迁移三件套**（仓库硬约定：不用 Alembic、`backend/sql/*.sql` 是无代码执行的 MySQL 方言、
靠 Python 幂等脚本 + 逐列存在性探测；先例 `b76ad7c`）：

- `backend/scripts/_product_and_drama_plan.py` —— 四张表 DDL 清单**唯一一份**（迁移与回滚共用，
  `_llm_pipeline_columns.py:3-6` 记录过两处各写一份导致漂移的真实事故）；import 期自检。
- `backend/scripts/migrate_product_and_drama_plan.py` —— 先 `backup_database()`（SQLite backup API，
  WAL 下拷文件会丢数据）→ 建表 → `verify_schema()` 逐列校验；支持 `--check` / `--print-only`（只读）。
- `backend/scripts/rollback_product_and_drama_plan.py` —— 回滚。
- `backend/tests/test_product_and_drama_plan_migration.py` —— 清单 ↔ ORM ↔ PRAGMA 三方对账
  （照 `test_chapter_asset_record_migration.py:297-336`）。

## 类型枚举点同步（MVP 只同步读取侧）

权威清单在全量方案「影响面 §2」，**注意原方案路径是简写**，实际前缀：
`image_pipeline/*` → `app/services/studio/image_pipeline/*`；`routes/studio/*` → `app/api/v1/routes/studio/*`。

MVP 必改（约 40 处中的核心）：

- `app/services/studio/entity_specs.py`：`normalize_entity_type` 白名单（`:68-75`）加 `product`；
  `entity_spec()` **必须加显式 `if product` 分支**——现在 costume 是隐式 `else` 兜底（`:119-137`，已核实），
  不改会静默落到 costume 分支；`LINK_MODEL_BY_ENTITY`（`:47-52`）加 `ProjectProductLink`。
- `app/services/studio/image_pipeline/reference_resolver.py:31,38`：`IMAGE_MODEL_BY_ASSET_TYPE` /
  `PARENT_FIELD_BY_ASSET_TYPE` 加商品（**不加就取不到商品定版图**）。
- `app/services/studio/bound_asset_files.py:41,51`、`app/services/studio/image_pipeline/adopt.py:54`
  （`ADOPTABLE_ENTITY_TYPES`，其注释与代码已不一致，顺手修正注释）、
  `app/services/studio/image_pipeline/prompt_package.py:44`。
- `app/services/studio/asset_overlays.py:81` `GLOBAL_ASSET_TYPES` 加 `product`。
- `app/services/studio/asset_profiles.py:47,49-54,72-115,313-347`：`ASSET_TYPES` / `TYPE_LABELS` /
  `PROFILE_FIELD_SPECS` / `DEFAULT_TYPE_ALIASES`。**商品资料字段分两档**：必填 = 名称 + 外观描述；
  可选 = 材质 / 颜色 / 规格 / 包装 / Logo / 卖点关联。⚠️ 不定两档会被工作台「旧提示词质量重判」
  把只填了名字的 brief 整批判成「待补资料」。
- `app/api/v1/routes/studio/entities.py` 统一 CRUD 靠 `entity_specs` 自动覆盖；
  `app/api/v1/routes/studio/shots.py:686-826` 混合形状：1 条通用 GET + 8 条类型专用 POST/DELETE，
  **商品要补自己的两条专用端点**。
- schemas 的 Literal（`schemas/studio/image_pipeline.py:15`、`shots.py:319`、
  `llm_orchestration.py:18/297`、`assets.py:145`）与 `utils/project_links.py:13` 的 `AssetField`。
- 安全网：`backend/tests/test_asset_type_dispatch.py:233` 与 `test_prop_image_prompt_slots.py:119`
  钉住了旧枚举，**改类型时它们必须被同步更新而不是绕过**；改完全仓跑 `uv run pytest -q`。

后置到通道批（MVP 不动）：`asset_strategies.py` 的 `STRATEGIES`/`SUPPORTED_ASSET_TYPES`、
`channel_submit.py`、`asset_prompt_batch.py`、`image_tasks.py`、`asset_workbench.py`、
`core/task_manager/stores.py`、`registry.py:199/317`、`llm_orchestration/asset_binding.py`。

## 编排与接口（三件套 + brief 保存）

照全量方案「落点对照」与「实现要点」，新增：

- `app/services/studio/llm_orchestration/drama_plan.py`（照 `entity_extraction.py` 形状）：
  模板进 `prompt_templates.py`（`string.Template` + `$name`，**禁用 `str.format`**）；
  解析与兜底用 `json_utils` 三级抢救；失败走 `support.raise_parse_failure` →
  422 `llm_json_parse_failed` 且**不落库、不写半成品**。
- 提示词配方（移植内核，不依赖参考项目云平台）：开场 3 秒有可拍摄的动作冲突；卖点剧情化
  （转成人物欲望/冲突/破功瞬间，不念参数）；起势—升级—反转；商品至少出现一半镜头；
  结尾反转 + 自然购买暗示；每镜给角色/动作/台词/时长/商品是否出现。
  输出结构：`title/logline/sellingPoints/characters/scenes/product/shots/climax`。
- 路由（`app/api/v1/routes/studio/` 新文件或并入 chapters 风格，挂 `paid_outlet_guard.require_llm_outlet`）：
  - `PUT /studio/chapters/{chapter_id}/drama-plan/brief` —— 保存 brief，免费，不触模型。
  - `POST /studio/chapters/{chapter_id}/drama-plan/generate` —— 付费生成；租约防重复；
    服务内走 `dry_run` 判定（演练返回 `[DRY_RUN]` 占位，不落库）。
  - `GET /studio/chapters/{chapter_id}/drama-plan` —— 只读（brief + 草稿 + 状态），永不付费。
  - `POST /studio/chapters/{chapter_id}/drama-plan/confirm` —— materialize，一个事务；
    校验：角色/场景引用可解析、**商品关联行覆盖 ≥ 一半镜头**（由关联行数判定，不信模型自述）。
- 「商品至少一半镜头」不加布尔列，用 `project_product_links`（shot 档）表达——全量方案已论证。

## materialize 映射（新写 `drama_plan_materialize.py`）

| DramaPlan 字段 | 落点 |
|---|---|
| `title` / `logline` | `chapters.title` / `chapters.summary` |
| `characters[]` | `characters` 资产（唯一带 `project_id` 的资产表） |
| `scenes[]` | `scenes` + `project_scene_links` |
| `product` | `products` + `project_product_links`（项目档 + 逐镜 shot 档） |
| `shots[].index/title/script_excerpt` | `shots` 对应列（守 `uq_shots_chapter_index`） |
| `shots[].duration` | `shot_details.duration`（整数秒，镜头唯一时长来源） |
| `shots[].camera` | `shot_details.camera_shot/angle/movement`（英文 code，非法值落默认并记入 warnings） |
| `shots[].action` | `shot_details.action_beats`（JSON list[str]）+ `description` |
| `shots[].dialogue` | **`shot_dialog_lines` 独立表**（`text/index/line_mode/speaker_*`）——`_append_division_rows` 不写这张表，这是新函数存在的核心理由 |

## 前端（最小入口）

照 `0785e0e` 先例，只动四处：`front/src/App.tsx`（import + Route）、
`front/src/layouts/MainLayout.tsx`（`selectedKeys`/`pathLabels`/`menuItems`）、新页面文件、
`front/src/services/dramaPlanApi.ts`。
⚠️ 已提交的 `front/openapi.json` 与源码**已漂移**（165 路由 vs 138 path），新端点**绕过 generated client**：
用 `services/llmPipelineApi.ts` 的 `callApi` + 运行时探测 `/openapi.json`
（先例 `assetProductionApi.ts:395-425`），不要手改 `generated/`。
页面形态：brief 表单（商品名/描述/卖点/人群/题材/调性/时长/镜头数/品牌调性/必含/禁用/导演备注）→
生成按钮（标明「将调用 1 次模型」）→ 草稿编辑器（整体重生成 + 按段重生成 + 逐字段/逐镜编辑）→
显式「确认落成正式内容」→ 跳回项目工作台第 1 步。
项目内入口：工作台或章节页加一个「剧情策划」按钮即可，不改五步模型。

## 执行顺序（每步独立 commit）

| # | 步骤 | 怎么验 | 需用户点头 |
|---|---|---|---|
| 0 | 把所用 Model 行 `params.max_tokens` ≥ 8192；确认首发模型与典型镜头数 | 配置复核 | **是**（模型与预算） |
| 1 | 迁移三件套（四张表） | `--check` 只读；对账测试过；执行后逐列一致；回滚后表消失 | **是**（改正式库前先演练库验证） |
| 2 | ORM 模型 + `models/types.py` 枚举 + `GLOBAL_ASSET_TYPES` | `uv run pytest -q` 无新增失败 | 否 |
| 3 | 读取侧枚举点同步（上文清单） | `test_asset_type_dispatch.py` 等安全网测试更新后全绿 | 否 |
| 4 | 商品 CRUD + 分镜关联两端点 + 商品图「上传 file_id → product_images 行 → 定版」小端点 | 接口级测试；定版保护（已有定版需显式确认替换） | 否 |
| 5 | 编排步骤 + 付费守卫 + DTO | 演练模式返回 `[DRY_RUN]` 占位且零落库；故意改坏 JSON → 422 不落库 | 否 |
| 6 | 草稿三件套 + brief 保存 + 租约 | 刷新不丢；连续点击不重复付费（租约）；未开始/失败状态可区分 | 否 |
| 7 | `drama_plan_materialize.py` + confirm 校验 | 章节+N 镜+对白行+资产+关联行一次事务落地；≥一半镜头校验生效；失败整体回滚 | 否 |
| 8 | 前端面板页 + 项目内入口 | `pnpm exec tsc --noEmit` + `pnpm test`；手工走查一遍（演练模式） | 否 |
| 9 | 真实 1 次调用验收 | 用户手动点；产出合法 DramaPlan；确认后五步流程能读到产物 | **是**（逐次确认付费） |

## 验收标准

- 演练模式（`JELLYFISH_DRY_RUN` 未设置即演练）下全链路可走通且**零付费、零正式行**；
  漏挂守卫的路径由 `paid_outlet_guard` 兜底 409（`meta.error.paid_call_made == false`）。
- 真实模式一次调用产出合法 DramaPlan；截断/类型错/缺字段经三级抢救后可用，
  或明确 422 且不落库。
- 草稿刷新不丢、重复点击不重复付费；brief 保存永不触模型。
- 确认后：章节 + N 条分镜（时长=方案秒数）+ 对白行 + 角色/场景/商品资产 + 关联行全部落地；
  商品关联覆盖 ≥ 一半镜头；既有五步流程直接读到这些产物，不新开第二条生产链。
- 商品手动上传定版图能被 `reference_resolver` 解析，出现在帧生成 `reference_labels` 里。
- 后端 `uv run pytest -q` 无新增失败（基线：既有 13 条失败，见交接汇总）；
  前端 `pnpm exec tsc --noEmit` 与 `pnpm test` 过。

## 硬要求（沿用仓库铁律）

付费出口必须过 `paid_outlet_guard` + `dry_run`；产物来源不许冒充（模板/演练产物不得写正式列）；
api 层收参、service 层业务，新函数带「做什么/为什么存在」注释；状态语义变更四处同步；
不改上游出图服务项目；**不触发真实付费调用，除非用户逐次明确确认**；
不提交 `.env` / 数据库 / outputs / 生成图视；CI 不跑 pytest，本地必须自己跑。

## 待用户拍板（只剩两条）

1. **首发模型 + 典型镜头数**（决定 `max_tokens` 目标值与「一次调用」是否够用；≥8 镜建议重新评估）。
2. **正式库迁移许可**（步骤 1 在正式库执行前）。
