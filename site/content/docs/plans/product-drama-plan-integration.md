---
title: "商品剧情策划（DramaPlan）接入方案"
description: "把「商品卖点 → 剧情方案」的策划内核接进 Jellyfish：一次编排调用产出可编辑的 DramaPlan 草稿，人工确认后落成章节/分镜/资产，并新增「商品」资产类型"
weight: 9
---

> 本文属于“任务计划”文档，描述**尚未落地、待用户拍板**的接入方案。
> 落地后，把“当前已生效的规则”沉淀到 `architecture`，把这一篇收口或删除。

## 背景（用户 2026-09-25 决定）

外部参考项目里有一套「商品卖点 → 剧情广告」的策划做法。用户决定把它移植进 **Jellyfish**（不是中控台）。
值得移植的只有四件东西，它们都不依赖那个项目的云平台：

1. 一份**有主见的剧情策划提示词**：开场 3 秒必须有可拍摄的动作冲突；卖点不许直接念参数，必须转成人物欲望、
   冲突或破功瞬间；结构要有起势—升级—反转；商品至少出现在一半镜头；结尾反转 + 自然购买暗示；
   每个镜头都要给出角色、动作、台词、时长、商品是否出现。
2. 一个**固定输出结构**：`title` / `logline` / `sellingPoints` / `characters` / `scenes` / `product` / `shots` / `climax`。
3. 一个**输出标准化函数**：模型返回的 JSON → 解析、字段兜底、类型纠正。
4. 一套**镜头参考资产组装规则**：哪张图是商品、哪张是哪位角色、哪张是场景；
   并要求保持商品包装 / Logo / 颜色、人物脸 / 发型 / 服装。

**不搬**：它的云客户端、登录校验、积分与退款、上传接口、轮询接口、浏览器端 FFmpeg 合成，
以及 `Generate all` 一键黑盒。

本文档只定**边界、落点与待决项**：不含实现，不改代码，不改库，不触发任何付费调用。

## 三条结论（先说，因为它们决定工作量）

**1. 第 4 件（参考资产组装）Jellyfish 已经有了，而且比参考实现更完整 —— 不需要移植。**

现成链路是：绑定资产的**定版图** → 帧提示词的参考图 → 关键帧 → 视频。
其中“哪张图是谁的定版图”这件事已经有明确标签（`reference_labels`，形如「角色『张三』的定版图」）。
所以这一部分的工作不是“把规则搬进来”，而是**让「商品」这一类能进既有解析表**（两处 dict，见「影响面」）。

⚠️ 并且**不能**把商品图直接塞进视频请求：`generation/video/build_context.py:24-31` 的
`validate_images_count()` 会按 `reference_mode` 严格校验图片数量，数量不符直接 400。
商品图必须在**帧**那一环进去（`image_pipeline/frame_submit.py:172-221`）。

**2. 「一次调用出结构化草稿 + 必须显式确认才成为正式产物」已有成熟先例 —— 照抄，不要发明新范式。**

先例是集级视频提示词看板。它的三条边界可以直接照搬到剧情方案上
（来源：`backend/app/services/studio/prompt_board_drafts.py` 文件头）：

- 草稿表**只放草稿**，任何情况下都不写正式列；写正式列只有一条路（显式 save）；
- **未开始不落行**：没有行 = 未开始，这样“未开始”和“失败”在数据层不会混淆；
- **租约（claim）防重复付费**：同一目标在租约内只能生成一次，租约到期自动可抢，
  避免进程被杀 / 页面关掉之后永久卡住。

**3. 真正的成本不在提示词，而在新增一个「商品」资产类型。**

资产类型在这个仓库是**横向切开**的：后端有 78 个 `.py` 文件出现 `costume`，
分散的枚举点约 120 处。最近一次“给**已有**类型补生产链路”的提交是
`750148e`（2026-09-25）**12 个文件 / 2794 行插入**（含 1080 行测试）；
最近一次“加两张表”的提交是 `b76ad7c` **24 个文件 / 5056 行**。
新增一整个类型只会更多。

## 落点对照（方案里的概念 → Jellyfish 现成件）

| 移植单元 | Jellyfish 现成件 | 证据 |
|---|---|---|
| 提示词配方 | `backend/app/services/studio/llm_orchestration/prompt_templates.py`：`string.Template` + `$name` 占位（**刻意不用 `str.format`**，避免 JSON 示例的大括号被误解析） | 文件头「迁移原则」 |
| 编排层整体形状 | `llm_orchestration/`：组装上下文 → 构建提示词 → 调 LLM（过守卫）→ 解析 JSON + 确定性后校验 → 返回预览 | `llm_orchestration/__init__.py:3-9` |
| 确定性词表 | `llm_orchestration/registry.py`：实体类型白名单 / 别名 / 拒绝提示；**词的来源与提示词分离**，防止模型改写词表 | `registry.py:1-5`、`:18`、`:47-50` |
| JSON 抢救与归一化 | `llm_orchestration/json_utils.py`：三级抢救（直解析 → 去尾随逗号 → 括号配平）+ `coerce_*` + `normalize_name` | `json_utils.py:104-146` |
| 失败统一形状 | `llm_orchestration/support.py`：`raise_parse_failure` → 422 `llm_json_parse_failed`（带 `raw_output_preview` / `hint`） | `support.py:67-98` |
| 付费出口守卫 | `services/paid_outlet_guard.py`（`require_llm_outlet` 等依赖；409 + `meta.error` + `paid_call_made: false`）+ `llm_orchestration/dry_run.py` | `paid_outlet_guard.py:216-221`、`:130-160` |
| 草稿态存储 | `services/studio/prompt_board_drafts.py` + 表 `shot_video_prompt_drafts`（共享主键 `shot_id`、`claim_token`、`claim_expires_at`、状态 `running/ok/failed`） | `prompt_board_drafts.py` 文件头；模型 `studio_shots.py:271-358` |
| 草稿 → 正式产物 | `services/studio/prompt_board.py`：默认**只补空白**、导入**先预览后落库**、模板/演练**不得冒充大模型** | `prompt_board.py` 文件头三条硬约束 |
| “生成 / 只读 / 确认”三件套 | `routes/studio/chapters.py`：POST 生成（可能真实调用）、GET 只读（`allow_generate=False`）、POST confirm | `chapters.py:266`、`:315`、`:370` |
| 落库成章节 / 分镜 | `services/studio/script_division.py`：`_append_division_rows` 一次写 `Chapter / Shot / ShotDetail` | `script_division.py:14-22` |
| 镜头参考资产组装 | `bound_asset_files.to_shot_linked_asset_items` → `frame_submit.resolve_frame_reference_targets`（产出 `reference_file_ids` + `reference_labels`） → `ShotFrameImage` → `build_context.resolve_video_reference_images` | `frame_submit.py:172-221`、`build_context.py:34-72` |
| 资产类型扩展先例 | `costume`：唯一走 Jellyfish 自己 APIMart 通道的类型（`channel=CHANNEL_APIMART`） | `image_pipeline/costume_channel.py:1-30`、`asset_strategies.py:212` |
| 项目起点扩展 | `ProjectStartMode`（`script` / `prompts`）；列是 `String(16)`，**加取值不改表** | `models/types.py:26-37`、`studio_projects.py:46-52` |
| 前端五步模型 | `front/src/pages/aiStudio/project/ProjectWorkbench/projectSteps.ts` | 该文件 `:15-31`、`:86-118`、`:277-401` |

## 目标流程

1. **起点**：新建项目选「从商品剧情开始」，填一份 DramaBrief：
   商品名 / 商品描述 / 卖点列表 / 目标人群 / 题材 / 风格 / 时长 / 镜头数 / 品牌调性 / 必含元素 / 禁用元素 / 导演备注。
2. **生成**：**一次**编排调用 → DramaPlan（JSON）→ 归一化 → 落**草稿**（刷新不丢、重复点击不重复付费）。
3. **编辑**：草稿可整体重生成、可改任意字段（标题、卖点、人设、角色分配、每镜的动作 / 台词 / 时长 / 商品出现与否）。
4. **确认**：用户显式确认 → materialize 成正式产物（项目 / 章节 / 资产 / 分镜），走既有写库路径。
5. **之后**：完全交回既有的五步流程（资产准备 → 整集提示词 → 绑定 → 生成与交付），**不新开第二条生产链**。

关键取舍：**剧情方案是“草稿”，不是“第二套数据模型”**。正式产物只有一套（项目 / 章节 / 资产 / 分镜），
方案确认之前不落任何正式行。

## 数据契约（草案）

### DramaBrief（输入）

| 字段 | 说明 | 落点 |
|---|---|---|
| `product_name` / `product_description` | 商品名与描述 | 商品资产的 `name` / `description`（列形状同 `Prop`） |
| `selling_points` | 卖点列表（提示词里必须被“剧情化”，不许直接念参数） | 项目级设置 / 草稿行 |
| `target_audience` | 目标人群 | 项目级设置 / 草稿行 |
| `genre` / `tone` | 题材 / 调性 | 与既有 `ProjectStyle`（7 个中文取值）对齐，`models/types.py:6-16` |
| `duration_hint` / `shot_count` | 时长 / 镜头数 | 影响 `shot_details.duration`（秒）与分镜条数 |
| `brand_voice` / `mandatory_elements` / `forbidden_elements` / `director_notes` | 品牌规则与导演要求 | 项目级设置或提示词组装层 |

### DramaPlan（输出）→ 正式产物的映射

| DramaPlan 字段 | 落点 | 说明 |
|---|---|---|
| `title` | `chapters.title`（`studio_projects.py:116`） | 集标题 |
| `logline` | `chapters.summary`（`:117`） | 一句话主线 |
| `characters[]` | `characters` 资产（+ `CharacterImage` 定妆图） | 注意：`characters` 是**唯一带 `project_id`** 的资产（`:242-248`） |
| `scenes[]` | `scenes` 资产 + `project_scene_links` | 场景表本身**没有** `project_id` |
| `product` | **新增的「商品」资产** | 见「影响面」 |
| `shots[].index` / `.title` | `shots.index` / `shots.title`（`studio_shots.py:44-45`） | 章节内唯一（`uq_shots_chapter_index`） |
| `shots[].script_excerpt` | `shots.script_excerpt`（`:64`） | 摘录 |
| `shots[].duration` | `shot_details.duration`（`:189`，“镜头唯一时长来源”） | 整数秒 |
| `shots[].action` | `shot_details.action_beats`（JSON `list[str]`，`:213-218`）+ `description`（`:207-212`） | 动作拍点按时间顺序 |
| `shots[].camera`（景别 / 机位 / 运镜） | `shot_details.camera_shot` / `.angle` / `.movement`（`:153-167`） | 存英文 code |
| `shots[].dialogue` | `shot_dialog_lines` 表（`text` / `index` / `line_mode` / `speaker_*`） | 对白是**独立表**，不是列 |
| `shots[].product_present` | **不新增列** —— 用「镜头 ↔ 商品关联」表达 | 见下 |

**关于“本镜是否出现商品”**：不需要给 `shots` / `shot_details` 加布尔列。
这个仓库里“角色 / 场景 / 道具出现在某镜”本来就是用**关联行**表达的
（`Shot.prop_links`，`studio_shots.py:95-100`；`ProjectPropLink`，`studio_projects.py:207-224`；
实证读取见 `services/studio/shot_extraction_draft.py:185-197`）。
商品照此新增 `ProjectProductLink` 即可，于是「商品至少出现在一半镜头」这条规则
可以**直接由关联行数校验**，而不依赖模型自述。
加列还会带来额外风险：布尔列与关联行可能互相矛盾。

## 实现要点（待做）

| 组件 | 说明 |
|---|---|
| 契约层 | `backend/app/schemas/studio/` 新增 DramaBrief / DramaPlan 的 DTO。注意：编排层**不对模型原始输出做 pydantic 校验**，校验发生在构造响应 DTO 时 |
| 编排步骤 | 新增一个服务模块（照 `entity_extraction.py` / `video_prompt.py` 的位置与形状）：模板进 `prompt_templates.py`，词表与白名单进 `registry.py`，**没有步骤注册表**，分派靠“一模块一 `preview_*` 一路由”的约定；新增后要在 `llm_orchestration/__init__.py` 的导入块与 `__all__` 挂名 |
| 付费守卫 | 路由挂 `paid_outlet_guard.require_llm_outlet`（router 级或单路由 `dependencies=`）；服务内再走 `dry_run` 判定 |
| 草稿存储 | 新增草稿表（照 `shot_video_prompt_drafts`：状态 `running/ok/failed`、未开始不落行、`claim_token` + `claim_expires_at` 租约） |
| 草稿 → 正式 | 照 `chapter_asset_profiles` 的**三件套**：POST 生成 / GET 只读（`allow_generate=False`）/ POST confirm（一个事务落库）；分镜写库复用 `script_division._append_division_rows` |
| 校验 | 「商品至少一半镜头」由关联行数校验；角色 / 场景引用必须能在已确认资产里解析到，不允许悬空引用 |
| 前端 | 新页面照 `0785e0e` 的先例：只改 `App.tsx`（import + Route）、`layouts/MainLayout.tsx`（`selectedKeys` / `pathLabels` / `menuItems`）、新页面文件、`services/<xxx>Api.ts`；API 变更后跑 `pnpm run openapi:update`（需后端在 `127.0.0.1:8000`） |
| 文档 | 落地后按 AGENTS.md 把“当前已生效的规则”沉淀到 `site/content/docs/architecture/`；本文档收口 |

⚠️ 前端有一个**既成事实**要注意：已提交的 `front/openapi.json` 与源码**已经漂移**
（源码 165 个路由装饰器 vs spec 里 138 条 path；`reference-regenerate` / `asset-workbench` /
`asset-image-prompts` / `asset-profiles*` 都不在生成物里）。因此最近的新页面**绕过 generated client**，
用 `services/llmPipelineApi.ts` 的 `callApi` + **运行时探测 `/openapi.json`** 判断新端点是否上线
（`assetProductionApi.ts:395-425`）。剧情策划这条新链路应沿用同一套做法，不要手改 `generated/`。

## 影响面：新增「商品」资产类型

用户已拍板：**新增独立资产类型**（不复用 `prop`）。以下是必须同时改到的地方 —— 漏一处就会出现
“静默按人物处理”“商品定版图取不到”或直接 400。

### 1. 数据模型与表（照 `Prop` / `PropImage` / `ProjectPropLink`）

- 新表 `products`：字段照 `Prop`（`studio_assets.py:64-117`）——
  `id` String(64) PK / `name` String(255) / `description` Text / `style` String(32) /
  `view_count` Integer / `tags` JSON / `image_prompts` JSON / `prompt_template_id` FK 可空 /
  `visual_style` String(16)；配 `ix_products_name` + `uq_products_name`。
- 新表 `product_images`：照 `PropImage`（`studio_asset_images.py:183-234`）——
  `file_id` FK 可空 / `quality_level` / `view_angle` / `width` / `height` / `format` / `is_primary`；
  唯一约束 `uq_product_images_quality_angle(product_id, quality_level, view_angle)`。
  （`is_primary` 无库级唯一约束，靠应用层保证“同一资产至多一张主图”。）
- 新表 `project_product_links`：照 `ProjectPropLink`（`studio_projects.py:207-224`）——
  `(project_id NOT NULL, chapter_id 可空, shot_id 可空, product_id NOT NULL)` 的**三档作用域**
  + 唯一约束 `uq_project_product_links_product_scope(product_id, project_id, chapter_id, shot_id)`。

**“有无 project_id”是一个必须先定的口径**：`Scene/Prop/Costume/Actor` 四张表**都没有 `project_id`**
（全局资产，归属只由 `project_*_links` 表达，见 `asset_overlays.py:81` 的 `GLOBAL_ASSET_TYPES`）；
只有 `characters` 带 `project_id`（`studio_assets.py:242-248`）。商品走哪一种，决定它能否跨项目复用。

### 2. 类型枚举点（必须同步；已核实的清单）

**权威四元组与派生表**
| 位置 | 现值 |
|---|---|
| `services/studio/asset_profiles.py:47` `ASSET_TYPES` | `(character, scene, prop, costume)` |
| 同文件 `:49-54` `TYPE_LABELS`、`:72-115` `PROFILE_FIELD_SPECS`、`:313-347` `DEFAULT_TYPE_ALIASES` | 商品需要自己的资料字段（材质 / 颜色 / 规格 / 包装 / Logo / 卖点关联）与中英别名 |
| `services/studio/project_asset_readiness.py:57` | **同名重复副本** |
| `services/studio/chapter_asset_candidates.py:31`、`chapter_asset_profiles.py:89` | `CANDIDATE_TYPES` |

**多态分派（唯一真正 registry 化的地方）**
| 位置 | 现值 |
|---|---|
| `services/studio/entity_specs.py:68-75` | 硬编码 5 类白名单，**含 actor**：`{actor, character, scene, prop, costume}` |
| 同文件 `:78-137` `entity_spec()` | `if actor / if character / if scene / if prop / else costume` ——**costume 是隐式 else 兜底**，加商品时必须显式改这里，否则会落到 costume 分支 |
| 同文件 `:47-52` `LINK_MODEL_BY_ENTITY` | 4 个 link 模型 → `(模型, 外键列)` |

**出图与参考图解析**
| 位置 | 现值 |
|---|---|
| `image_pipeline/asset_strategies.py:165-214` `STRATEGIES` | 4 类各自的 `prompt_slot` / `prompt_template` / `result_kind` / `generation_type` / `channel` |
| 同文件 `:217` `SUPPORTED_ASSET_TYPES` | `(character, scene, prop, costume)` |
| `image_pipeline/reference_resolver.py:31` `IMAGE_MODEL_BY_ASSET_TYPE`、`:38` `PARENT_FIELD_BY_ASSET_TYPE` | 4 类图片表 / 4 个外键字段 ——**不加就取不到商品定版图** |
| `image_pipeline/prompt_package.py:44` `REFERENCE_SLOT_BY_TYPE` | 4 类 → 槽位 |
| `image_pipeline/adopt.py:54` `ADOPTABLE_ENTITY_TYPES` | 5 类（注释说“三类”，**注释与代码已不一致**） |
| `services/studio/asset_prompt_batch.py:52` | 4 类 |
| `services/studio/image_tasks.py:262-277` `asset_prompt_category` | 字典键**没有 `character_image`**，缺失时是无条件 `mapping[relation_type]` → `KeyError` |
| `services/studio/bound_asset_files.py:41` `SLOT_LABELS`、`:51` `SLOT_ASSET_TYPE` | 绑定资产 → 槽位/类型 |
| `services/studio/asset_workbench.py:159-161` `TASK_RELATION_TYPE` | 由 `ASSET_TYPES` 自动派生，改 `ASSET_TYPES` 即覆盖 |
| `core/task_manager/stores.py:147-153` `image_like_models` | 5 个映射，`:199-202` 用 `getattr(model, f"{navigate_type}_id")` 分派 |

**LLM 编排侧词表**
| 位置 | 现值 |
|---|---|
| `llm_orchestration/registry.py:18` `ENTITY_TYPE_WHITELIST` | `(character, scene, prop)` ——**连 costume 都不在里面** |
| 同文件 `:20` 别名表、`:47-50` `ENTITY_TYPE_REJECT_HINTS` | costume 有显式拒绝提示可参照 |
| 同文件 `:199` `ASSET_IMAGE_PROMPT_SLOTS`、`:317` `SLOT_DESIGN_BRIEF_ASSET_TYPES` | 提示词槽位（仅 costume 有 design brief） |
| `llm_orchestration/asset_binding.py:75` `SLOT_ASSET_TYPES`、`:98` `CONFIRM_ENDPOINTS` | 槽位 → 类型；确认写库复用既有端点，**不新增 apply 路由** |

**其他**
- `utils/project_links.py:13` `AssetField = Literal["actor_id","scene_id","prop_id","costume_id"]`
- `services/studio/asset_overlays.py:81` `GLOBAL_ASSET_TYPES = ("scene","prop","costume")`
- `models/types.py:68-75` `ShotCandidateType`（character/scene/prop/costume）——列是 `String(32)`
  （`studio_shots.py:523`），**加成员不改表**；`models/types.py:218-241` `PromptCategory` 需加
  `product_image_front` / `product_image_other`
- schemas 的 4 个 Literal：`schemas/studio/image_pipeline.py:15`、`schemas/studio/shots.py:319`、
  `schemas/studio/llm_orchestration.py:18/297`、`schemas/studio/assets.py:145`
- 前端约 20 处联合类型，且**已经互相矛盾**：`assetResultKind.ts:212` 只 3 类 vs
  `assetProduction.ts:159-162` 4 类；`llmPipelineApi.ts` 同时有 3 类和 5 类两套
- 钉住枚举的既有测试会**立刻失效**：`tests/test_asset_type_dispatch.py:233`
  `assert strategies.SUPPORTED_ASSET_TYPES == ("character","scene","prop","costume")`、
  `tests/test_prop_image_prompt_slots.py:119`
- `backend/sql/002-add-shot-extracted-candidates.sql:63-64` 有一条 CHECK 枚举了 4 类 ——
  但该目录**没有任何代码执行**（见下），不要把它当成约束

### 3. 出图通道：商品**不能**直发上游出图服务

上游（另一个项目，只读、不可改）契约只接受三类：
`image_pipeline/external_image_client.py:35` `SERVICE_ASSET_TYPES = ("character","scene","prop")`，
注释明写「出图服务 V0 只接受这三种资产类型（costume 不在其契约内）」；
同文件 `:82` `DEFAULT_GENERATION_TYPE` 也是 3 键。

`costume` 已经走过这条路：它建了**自己的** APIMart 图片通道
（`image_pipeline/costume_channel.py`，经 `channel_submit.py:155/191/394` 按类型路由），
与「用已有参考图重新生成」同一条 provider 解析与守卫，只是不带 `image_urls`。
**商品应当照这个先例再建一条**，而不是改上游契约。

### 4. 迁移三件套（仓库既有硬约定 —— 与 Alembic 无关）

**先纠正一个容易踩的错**：本仓库**不用 Alembic**，也**不在启动时 `create_all`**
（`app/main.py:62-91` 的 lifespan 不调 `init_db()`）。
`backend/sql/*.sql`（001–008）是 **MySQL 方言**（`information_schema` / `PREPARE` / `MODIFY COLUMN`），
**没有任何代码执行它们**，`_chapter_asset_records.py:17-19` 明确解释了为什么改用 Python。
**所以不要往 `backend/sql/` 里加 `009-*.sql`。**

真实机制是两套并存：

1. **建全新库**：`cd backend && uv run python init_db.py` → `app/core/db.py:62-71` 的 `create_all`。
2. **改已有库**：`backend/scripts/` 下的**手写幂等脚本**，`sqlite3` 直连，**没有版本表**，
   靠“逐列存在性探测”（`PRAGMA table_info`）决定跳过什么。

因此商品需要新建四个文件：

- `backend/scripts/_product_assets.py` —— DDL 清单（`CREATE TABLE IF NOT EXISTS` /
  `CREATE INDEX IF NOT EXISTS`），带 import 期自检（DDL 列名与清单列必须一致，否则 `AssertionError`）；
- `backend/scripts/migrate_product_assets.py` —— **先 `backup_database()`**（SQLite backup API，
  WAL 下直接拷文件会丢数据；备份名 `jellyfish.db.backup_before_product_assets_{stamp}`），
  再建表，再 `verify_schema()` 逐列校验，缺一列返回退出码 1；支持 `--check` / `--print-only`（只读连接）；
- `backend/scripts/rollback_product_assets.py` —— 回滚；
- `backend/tests/test_product_assets_migration.py` —— **清单 ↔ ORM ↔ PRAGMA 三方对账**
  （照 `test_chapter_asset_record_migration.py:297-336` 的写法）。

清单必须**唯一一份**（迁移与回滚共用）：`_llm_pipeline_columns.py:3-6` 记录过两处各写一份导致
“迁移 11 列 / 回滚 10 列”的真实漂移。

### 5. 路由形状（新增商品要跟着改的地方）

- **统一实体 CRUD**：`routes/studio/entities.py:46/72/83/90/102` 用 `{entity_type}` 路径参数
  （模块 docstring：「统一实体 CRUD：actor/character/scene/prop/costume」）→ 靠 `entity_specs` 分派。
- **分镜侧的关联端点**：`routes/studio/shots.py:686-826` 是**混合形状** ——
  1 条通用 `GET /{entity_type}` + **8 条类型专用** POST/DELETE（`/actor` `/scene` `/prop` `/costume` …）
  → 商品需要补上自己的那两条。
- **图片任务**：`routes/studio/image_tasks.py:235/280` 的 `/assets/{asset_type}/{asset_id}/image-tasks`
  与 `/render-prompt`。

## 硬要求（沿用仓库既有铁律）

1. **付费出口必须过闸门**：`paid_outlet_guard` + `dry_run`。默认就是演练：
   `JELLYFISH_DRY_RUN` 未设置即演练，真实调用要同时满足 `JELLYFISH_DRY_RUN=0`
   **且** `JELLYFISH_REAL_LLM_CONFIRMED=1`（`dry_run.py:15-19`、`:49-50`）。
2. **产物来源不许冒充**：`product_guardrails.SAVABLE_VIDEO_PROMPT_SOURCES` 的白名单里
   `template` **不是来源**（模板拼装只是预览）；演练占位文本（`[DRY_RUN 占位]`）写进正式产物字段要 422 拒绝。
3. **API 变更后跑 `pnpm run openapi:update`**（在 `front/` 下执行，需要后端已在 `127.0.0.1:8000`；
   `front/package.json:15-17`）；前端不新增手写 service 封装（AGENTS.md 代码规范 1-2）。
4. **api 层收参、service 层业务**；新增函数必须有“做什么 / 为什么存在”的注释（AGENTS.md 代码规范 4-5）。
5. **状态语义变更要四处同步**：后端实现 / OpenAPI / 前端 generated types / 开发文档
   （AGENTS.md 状态语义约定 5）。
6. **不改上游出图服务那个项目**，不移动、不复制、不合并。
7. **不触发真实付费调用**，除非用户逐次明确确认（`backend/scripts/acceptance_real_llm_run.py`
   是既有先例：硬上限 5 次调用、无重试、跑完恢复演练）。
8. **验证口径**：后端 `cd backend && uv run pytest -q`；前端 `pnpm exec tsc --noEmit` 与
   `pnpm test`（`node --test`）。注意 CI **不跑 pytest**，只跑 pylint，所以本地必须自己跑。

## 待拍板清单（需要用户定，否则不该开工）

1. **剧情策划是“第三种项目起点”还是“第 1 步里的一个动作”？**
   前者要给 `ProjectStartMode` 加第三个取值（列是 `String(16)`，**不改表**），
   但要同步 `front/src/.../projectSteps.ts` 的 `ProjectStartMode` 联合类型、`resolveProjectStep`、
   `ProjectStepNav`、`useProjectData`、mock 数据共 5 处前端引用与后端 `projects.py:210` 的分支。
2. **草稿表的键**：按项目一份，还是按章节（一集）一份？剧情方案天然是“一集一份”，
   照提示词看板就是 `(chapter_id, …)`。
3. **一次调用还是两次**：参考实现是一次调用出全部结构。一次调用的输出很长（角色 + 场景 + N 镜），
   失败要整份重来；拆成“卖点剧情化 → 分镜”两次会多花一次钱但更稳。
   **这条直接决定成本和稳定性**（注意：编排层**没有**模型自动重试，也没有主/备模型 fallback）。
4. **商品与道具的边界规则**：什么情况下判成商品而不是道具？由用户勾选、由提示词判定，还是入口就分开？
   注意实体提取白名单只有 3 类、不含 costume —— 若商品要参与自动提取，这条白名单也得一起动。
5. **商品图是否也要走上游出图服务**（映射成 prop）还是自建通道？本文档建议照 costume 先例自建。
6. **商品是“全局资产”还是“项目资产”？** 决定它进不进 `GLOBAL_ASSET_TYPES`，以及表里要不要 `project_id`。
7. **前端入口**：新增第 1 步之前的第 0 步，还是并入现有第 1 步「剧本与分镜」
   （`projectSteps.ts:86-118` 的 `DISPLAY_STEPS`）？

## 现状与风险

**现状（已核实）**

- 已有：`llm_orchestration/`（httpx + `dry_run` + `json_utils` + `prompt_templates` + `registry` +
  `support`）、`paid_outlet_guard`、四类资产体系、草稿表 + 租约、集级提示词看板、
  章节 → 分镜写库、项目工作台五步模型。
- **两套 LLM 体系并存且互不 import**：`chains/agents/`（LangChain，`script_processing.py` 在用，
  仓库自称 legacy）与 `llm_orchestration/`（httpx，新链路）。
  **新链路必须接后一套**，否则绕过 `dry_run` 的口径。
- **零基础**：全仓库没有任何“商品 / 卖点 / 带货”概念
  （`grep 带货|卖点|商品` 在 `backend/app` 与 `front/src` 无命中；
  `grep product backend/app/models backend/app/schemas` 也 0 命中）。
  `product_guardrails.py` 里的“产物”指 artifact，不是 merchandise —— **命名上不要撞**。

**风险**

1. **类型横向切开**：78 个后端文件涉及 `costume`，枚举点约 120 处。工作量主要在“把按类型分派的地方找齐”，
   漏一处就是静默降级（`reference_resolver` 取不到图 → 商品定版图缺失）或 `KeyError`（`image_tasks`）。
   既有测试 `test_asset_type_dispatch.py:233` 是天然的“安全带”，改类型时它一定会叫。
2. **一次调用输出长 JSON**：模型返回不合格是常态。既有兜底只有**解析层三级抢救**，
   **没有**模型重试、**没有**主备模型、**没有**对模型原始输出的 pydantic 校验。
   因此解析失败必须**不落库**（先例：演练/模板产物不得冒充模型产物）。
3. **上游出图服务是另一个只读项目**：商品若被误发上游会被拒；必须像 costume 一样在提交前按类型路由。
4. **迁移无版本表**：靠存在性探测保证幂等，写错就是“迁移跑过、回滚回不去”。
   必须三件套齐全 + 迁移测试对账。
5. **工作树状态**：本方案按用户指定落在 `pr41-latest`（工作树干净，比 `main` 严格更新）。
   `main` 工作树当前有 175 个未提交改动 —— 在那边动手会难以分辨改动归属。
   另：该目录是 git **worktree**，`backend/.venv` 是指向 `Jellyfish/backend/.venv` 的符号链接。

## 验收（草案，需随待拍板项定稿）

- **演练模式**（`JELLYFISH_DRY_RUN` 未设置即演练）下：填 DramaBrief → 提交 → 服务层按既有约定返回
  **占位结果**（`[DRY_RUN] …未调用任何大模型…`，见 `support.py:54-60`），
  数据库**零新增正式行**；若新路径漏挂守卫，则由 `paid_outlet_guard` 兜底返回
  **409**（`meta.error.paid_call_made == false`）。
- **真实模式**下一次调用产出合法 DramaPlan；把模型返回**故意改坏**（截断 / 类型错 / 缺字段）→
  经 `json_utils` 三级抢救后仍可用，或**明确失败（422 `llm_json_parse_failed`）且不落库**，
  不得写入半成品。
- 草稿刷新不丢；连续点击不重复付费（租约生效）。
- 确认后：章节 + N 条分镜 + 角色/场景/商品资产全部落地，`shot_details.duration` 等于方案里的秒数，
  镜头数与方案一致，商品关联行覆盖 ≥ 一半镜头。
- 商品定版图能被 `reference_resolver` 解析出来，并出现在帧生成的 `reference_labels` 里。
- 之后不新建第二条链：既有五步流程（资产准备 → 提示词 → 绑定 → 生成）能直接读到这些产物。
- 迁移：`migrate_product_assets.py --check` 只读不改库；执行后逐列与 ORM 一致；回滚后表消失；
  迁移测试通过。
