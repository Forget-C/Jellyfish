---
title: "广告剧情流程（剧情策划）"
description: "记录当前已生效的「商品卖点 → 剧情方案草稿 → 确认落成章节/分镜/资产」链路：数据流、出口性质、草稿状态与租约、落库映射，以及本批的明确边界"
weight: 9
---

> 本文属于“当前架构”文档，记录**当前已经生效**的实现与边界。
> 尚未做的部分写在“本批边界”一节里，不混入未来计划（计划见 `plans/`）。

## 定位

给短剧生产加一条**广告剧情**入口：把商品卖点变成一集可拍的分镜，产出的就是既有五步流程要读的
章节与分镜 —— **不是第二套生产链**。整条链路只有一段会花钱：一次模型调用。

```
商品信息（brief，免费保存）
   ↓  显式点「生成剧情方案」（付费：1 次文本模型调用，租约防重复）
归一化后的剧情方案草稿（只落 drama_plan_drafts.plan）
   ↓  人工逐字段/逐镜编辑（免费保存）
显式「确认落成正式内容」（一个事务）
   ↓
章节标题/主线 + 角色 + 场景 + 商品 + 分镜（含时长/景别/机位/运镜/动作拍点）+ 对白行 + 关联行
   ↓
既有五步流程（资产准备 → 整集提示词 → 绑定 → 生成与交付）直接接着用
```

## 出口性质（哪些会花钱一眼可数）

| 端点 | 出口 | 说明 |
|---|---|---|
| `GET /studio/chapters/{id}/drama-plan` | 免费 | 只读 brief 与草稿，永不调用模型 |
| `PUT /studio/chapters/{id}/drama-plan/brief` | 免费 | **只写 brief 列**，绝不动 `plan` / `status` |
| `PUT /studio/chapters/{id}/drama-plan/draft` | 免费 | 保存手改草稿；只写草稿列 |
| `POST /studio/chapters/{id}/drama-plan/generate` | **付费** | 一次文本模型调用；租约防重复 |
| `POST /studio/chapters/{id}/drama-plan/confirm` | 免费 | materialize，一个事务写正式产物 |
| `POST /studio/projects/{id}/drama-plan/chapter` | 免费 | 取/建一个没有分镜的可用空章节 |

守卫的挂法（与 `llm_orchestration` 四个预览端点同一套，**刻意不用** `dependencies=` 形式）：

- 服务层走 `dry_run` 判定：演练模式下**返回占位说明且不写 plan**（假 JSON 一旦写进草稿列就是污染），
  一次模型都不调；
- 路由用 `paid_outlet_guard.is_blocked_exception` 兜底，把漏挂守卫的路径变成统一结构化 409
  （`meta.error.paid_call_made == false`）。

> 为什么不用 `dependencies=[Depends(require_llm_outlet)]`：那条守卫在演练模式下直接 409，
> 会让“演练走通全链路”这条验收做不成。既有四个预览端点就是为此改成“服务层占位 + 路由兜底”。

## 草稿：状态语义与租约

`drama_plan_drafts`（**一章一行**，主键 `chapter_id`，`project_id` 冗余便于按项目查）：

| 列 | 语义 |
|---|---|
| `brief` | 用户输入的商品与导演要求；保存它**永不触发模型调用** |
| `plan` | 模型产物归一化后的草稿；**只有生成成功才写**，人工编辑也只改这一列 |
| `status` | `""`（行有了但从未生成）/ `running`（生成中，带租约）/ `ok` / `failed` |
| `claim_token` / `claim_expires_at` | 生成租约（300s）：同一章租约内只能生成一次，到期自动可抢 |
| `error` / `model` / `meta` | 失败原因、模型名、运行元信息（不含任何密钥） |

有一条**有意的偏离**：既有 `shot_video_prompt_drafts` 的做法是“未开始不落行”，
本表做不到 —— brief 保存是免费的、且必须持久（用户填一半要能存下来），
所以行由 brief 保存创建，“有没有生成过”由 `status` 表达。

结果的写入必须带**持有者令牌**：`mark_ok` / `mark_failed` 令牌不匹配就不写，
防止过期租约的迟到结果覆盖新结果。

## 落库映射（`drama_plan_materialize`）

| 草稿字段 | 正式落点 |
|---|---|
| `title` / `logline` | `chapters.title` / `chapters.summary`（并同步 `storyboard_count`） |
| `characters[]` | `characters`（**唯一带 `project_id`** 的资产表）+ `shot_character_links` |
| `scenes[]` | `scenes` + `project_scene_links`（项目档） |
| `product` | `products` + `project_product_links`（项目档 + **逐镜 shot 档**） |
| `shots[].index/title/script_excerpt` | `shots`（守 `uq_shots_chapter_index`） |
| `shots[].duration` / `camera` / `action` | `shot_details.duration` / `camera_shot`·`angle`·`movement` / `action_beats`·`description` |
| `shots[].dialogue` | **`shot_dialog_lines` 独立表**（`text` / `index` / `line_mode` / `speaker_*`） |

**「这一镜出现商品」不加布尔列**，唯一表达是 `project_product_links` 的 shot 档行 ——
于是「商品至少出现在一半镜头」由**行数**校验，不依赖模型自述。

边界与校验（都在确认时**再**做一遍，不信模型自述）：

- 章节**已有镜头则拒绝写入**（409 `drama_plan_chapter_not_empty`，与 `script_division` 同一口径）；
- 角色/场景非空且不重名；每镜出场角色与台词说话人必须能在人物表里解析到；
- 有商品时覆盖必须 ≥ 一半镜头（409 `drama_plan_product_coverage`）；
- 结构不合法（例如 `shots` 不是数组）→ 422 `drama_plan_invalid_draft`，且**不覆盖**已保存的草稿。

> 新写这支函数而不是复用 `script_division._append_division_rows`：那支把
> `camera/duration` 硬编码成 `ms/eye_level/static/4 秒`，且**不写对白独立表**，
> 方案里最有价值的部分会被整段丢掉。

## 商品 = 第五类资产，但本批只接“读取侧”

已生效（`products` / `product_images` / `project_product_links` 三张表，`GLOBAL_ASSET_TYPES` 含 `product`）：

- 通用实体接口 `/studio/entities/product`（列表/创建/读取/更新/删除）与
  `/studio/entities/product/{id}/images`（商品图：落 `file_id`、**已有定版要显式
  `confirm_replace_primary`** 才能顶掉，同槽位重复建图是 409 `entity_image_slot_exists`）；
- 分镜关联：`POST /studio/shots/links/product`、`DELETE /studio/shots/links/product/{link_id}`；
- 帧参考：`reference_resolver` 解析商品**定版图** → `frame_submit` 的
  `reference_file_ids` / `reference_labels`（标签是「商品『X』的定版图」；
  标签来源改走读取侧 `asset_profiles.TYPE_LABELS`，因为出图侧那张表只有四类）。

**口径写死**：商品外观只走**帧参考图**，**不进文本提示词** ——
`shot_video_prompt_pack` 组装资产引用时只认 character/scene/prop/costume，
没有 product 分支，并有测试锁住这条。

## 本批边界（明确没做的）

- **出图通道**：商品的出图侧枚举（`asset_strategies` / `channel_submit` / `asset_prompt_batch` /
  `image_tasks` / `asset_workbench` / task stores）**未接入**；商品图目前由用户手动上传 + 手动定版。
- **按段重生成**：后端没有“重新生成某一镜/某个资产”的端点；现有契约里重新生成就是**整份重来**
  （租约保护同一章并发只跑一次）。
- **项目起点枚举**：`start_mode` 仍是 `script` / `prompts` 两个取值；剧情策划是工作台里的一个
  按钮，**不是第六步**（`resolveProjectStep` / `ProjectStepNav` 未改动）。
- **工作台五类平权**：商品不进资产工作台的页签与批量区（`ASSET_TYPES` 含 product，
  但工作台页签在 TS 里写死四类，`by_type` 会多一个恒为 0 的键）。

## 相关文档

- 全量设计与影响面：`plans/product-drama-plan-integration`
- MVP 执行版需求：`plans/drama-plan-mvp-fast-track`
- 草稿与付费守卫的既有先例：`site/content/docs/architecture/llm-default-model-resolution`、
  `shot-status-flow`
