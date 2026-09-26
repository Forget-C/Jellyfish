# 六步主流程 · 验收结论（可复核）

> **最终状态以「零、最终状态」一节为准**（2026-09-21 收口）。第「一」节起是按轮次追加的
> **历史证据**，其中个别结论已被后续修复取代（例如巨日禄 401、最多保存 3 条、
> `partial_failed` 原样透传），已被取代处已就地标注「【已更新】」。本轮新增的四段
> （已完成 / 仍未验证 / 有意未重复执行 / 既有非本分支问题）见「零」。

## 零、最终状态（2026-09-21 收口）

### 0.1 已完成（有代码 + 测试 + 页面/接口证据）

| 能力 | 证据要点 |
| --- | --- |
| 五步主流程（工作台 1 剧本 / 2 提取资产 / 3 图片准备 / 4 视频提示词 / 5 生成与交付；工作室三步 3/4/5） | 步骤写地址栏、切步不丢镜头、就绪判定只有一份实现（供应商口径） |
| 两种项目起点 | 从剧本（拆镜 → 提取 → 出图）与从外部提示词（粘贴/上传 → 统一预览 → 回填镜头）都跑通 |
| 真实 LLM | 拆镜 1 次、资产提取 1 次、图片提示词 1 次、逐镜视频提示词 9 次；本轮另计逐镜草稿 2 次 |
| 真实出图 + 采纳定版 | 资产图 1 张（`gpt-image-2`）→ 采纳 → 设为定版（`character_images.id=42`，OSS 匿名 200 / 2,989,009 B） |
| 真实首帧 | `task_01M2Z8V3VPWMSJ9QC5XVQNGMM1`，55.5 s，文件 `6177fb25-…`，OSS 匿名 200 / 3,181,915 B，落 `shot_frame_images.first`，视频方案 `usable=true` / `ref_kind=public` |
| 真实 Seedance 视频 | 文件 `47c1f99f-…`，`seedance-2.0-mini / 16:9 / 5s / first`，140 s |
| 整集提示词草稿恢复 | 2 镜真实生成 → 草稿落服务端 → **刷新后仍在、新增加费调用 0** → 保存后 `video_prompt_source='llm'`、草稿清零 |
| 巨日禄整组导入 | 单一 scriptId `2933350`；31 镜连续 1–31；31 条提示词非空（1161–1921 字）；来源**全部 `jurilu`**；无另外两组混入；**零付费调用**；`/prompt-board/save` 已强制**单数 `script_id`**（校验先于任何写库，`script_ids` 明确 400）；OpenAPI 客户端已同步 |
| 资产与提示词绑定 / 导出 | 统一预览确认表 + 覆盖三模式；TXT 导出走真实文件下载（非 404 页面） |
| 真实模式配置（`.env` 生效） | 优先级 = 进程环境变量 → `backend/.env` → 默认；未配置默认演练；`.env` 打开真实模式时启动打醒目告警；状态接口与页面角标显示**配置来源**（只读，**不提供一键切换开关**）；独立进程用例覆盖 4 种情形 |
| 上传文件公网可达性统一 | 公开地址只有一个构造口径（没配 `s3_public_base_url` **不再**拼 path-style 假公网地址）；上传后匿名可达性验证并如实告警；不可达**不阻断上传**但页面可见 |
| legacy 视频入口预检 | `/film/tasks/video` 在建任务/写库**之前**走同一套素材可达性预检（不可达 → 409 + 真实状态码 + 修法 + `paid_call_made=false`）；派发改为**同进程内联**（不再无条件进 Celery 死队列） |
| 部分失败显示 | 三个互斥桶（完整成功 / 部分成功 / 失败）：一条 `partial_failed` = 完整成功 0 / 部分成功 1 / 失败 0；认不出的状态显式写「N 条状态未识别」，**不再出现有结果却显示 0/0** |

### 0.2 仍未验证（只保留确实没有证据的）

- **参考音频被供应商真实接受并据此影响生成结果**：本轮只在**请求计划/传输层**验证「我们会把哪个地址放进请求」，没有真实付费出视频；音色/口型/说话内容是否真按参考音频改变未验证；`asset://` 也**没有真实可用素材**跑通过。
- **真实模式下 8 个生成入口的端到端**：只做了代码路径 + outlet 名称 + 负例/占位核对（真实模式端到端需真实付费）。
- **`partial_failed` 的真机渲染**：DRY_RUN 下 submit 只回占位，那一行的真机颜色只有单测 + fixture 证据。
- **出图任务落库路径（`image_task_runner`）未加匿名可达性探活**：有意不加（worker 落库步没有用户可见告警通道，且会给持久化事务引入一次出网依赖）；输入侧已有提交前预检。
- **入口审计列出的 P1/P2 其余项**（拆镜先付费后校验、实体提取硬传 `refresh_cache:true` 绕过缓存、九槽位占位文本可被保存、入口 6/7 服务端缺幂等、4 个 `/studio/image-tasks/*` 仍默认入队、前端共享 API 层丢 `how_to_enable`、`/adopt` 无 host 白名单等）：**确认存在，本轮未改**，见 `backend/tests/test_entrypoints_audit.py`。

### 0.3 有意未重复执行（沿用已有证据，本轮零新增付费）

真实大模型调用、真实出图、真实首帧、真实 Seedance 视频、巨日禄真实抓取与整组保存 —— 本轮**没有再次花费**，
只引用既有任务号 / 文件 ID / 数据库行 / 页面证据，以及接口负例与代码检查。本轮新增的真实调用只有此前已授权的
两次（逐镜视频提示词草稿 2 次文本 LLM、首帧出图 1 次），其余全部在 DRY_RUN 下完成。

### 0.4 既有非本分支问题（不在本 PR 顺手改）

- 后端全量测试固定的 **13 条失败**全部是**信封契约**问题：`ApiResponse` 恒带 `meta: None`（`app/schemas/common.py`），
  而旧断言要求恰好三键。涉及 `test_api_response_envelopes.py`(2)、`test_entities_api_responses.py`(3)、
  `test_entity_existence_api_responses.py`(2)、`test_files_api_responses.py`(3)、
  `test_shot_character_links_api_responses.py`(1)、`test_shot_subresource_api_responses.py`(1)、
  `test_skills_integration.py::TestAppIntegration::test_health_returns_ok`(1)。
  已用全新临时库单独复现确认与本次改动无关；本 PR 只保证**不新增失败**（13 条逐字一致）。
- 巨日禄抓取在 DRY_RUN 下仍会真实访问第三方（用 `urllib`，而出站兜底只 patch `httpx`）；这是既有行为，
  本轮只把兜底做成显式开关（`JELLYFISH_NETWORK_GUARD=1`）并写清局限。

## 一、六步落在哪里


| 步骤 | 界面 | 地址 / 参数 |
|---|---|---|
| 1 剧本 | 项目工作台 | `?step=script` |
| 2 提取资产 | 项目工作台 | `?step=extract_assets` |
| 3 图片准备 | 项目工作台 | `?step=image_prep` |
| 4 视频提示词 | 章节工作室（三步中的第 1 步） | `?studio=video_prompt` + 当前集 |
| 5 关联绑定 | 章节工作室（三步中的第 2 步） | `?studio=binding` |
| 6 生成与交付 | 章节工作室（三步中的第 3 步） | `?studio=deliver` |

- 第 1-3 步在工作台就地完成；第 4-6 步按钮自动跳工作室并**落在对应步骤**（`?studio=` 两种取值都认：`generate_deliver` 与 `deliver`）。
- 工作室内部按「4. 视频提示词 / 5. 关联绑定 / 6. 生成与交付」分组页签，**切换步骤时当前分镜不丢**，步骤写在地址栏，刷新后仍停在同一步。
- 未显式指定步骤时，按信号判定"当前未完成步骤"并替换 URL；摘要条同时列出剩余缺口（镜头维度 + 资产维度）。
- 第 3/4/5/6 步都内联一块**只读**进度面板（不写库、不触网、不花钱），用户不必跳转就能看到还差什么。

## 二、四个数据衔接断点

### ① 生图读取已保存 / 定版的 image_prompts —— 已修实

两条生图路径都读它（此前只有 legacy 那条读）：

- legacy：`app/services/studio/generation/asset_image/build_base.py::saved_image_prompt_for`
- P3 管线：`app/services/studio/image_pipeline/image_pipeline.py::saved_image_prompt`
  并新增 `prompt_source`（`request` / `saved` / `template`）把来源显式带出来。

复核命令：

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"project_id":"script_3cdc1b751a","asset_type":"character","stage":"reference_batch","asset_ids":["CHAR_韩虹_2"],"use_primary_reference":true}' \
  http://127.0.0.1:8000/api/v1/studio/image-pipeline/plan/preview | python3 -m json.tool | head -30
```

实测输出：`prompt_source = saved`，`prompt` = 已保存的韩虹提示词，`reference_image` = 她的定版图。

界面证据：第 3 步「生图计划预览」（`/tmp/dsh_ui/step3_*.png`）——逐资产标 `已保存提示词 / 模板拼装`，保存后刷新仍显示 `用已保存提示词 1 条`。

### ② 视频提示词来源标记准确 —— 已修实

- 写入口白名单：`llm / jurilu / manual / skill`；`template` 直接 **422**（模板拼装没有模型参与，不算来源）。
- 演练占位文本（含 `[DRY_RUN 占位]`）写产物字段直接 **422**。
- 交付导出白名单与写入口一致，并额外放行库里已有的历史值（`manual_workspace / shot_description / internal`），否则 20+ 条已保存提示词会被静默丢掉。

界面证据：第 4 步进度面板实测 `有正文 41 条 / 来源已确认 28 条 / 还有 36 条镜头没有确认提示词来源` —— 差额被显式摆出来，不再看不见。

### ③ 生成结果回资产页查看 / 采纳且刷新后仍在 —— 已修实

`POST /api/v1/studio/image-pipeline/adopt`：下载 → 建 `files` 记录 → 写回图片槽位 `file_id` → 按需设为定版；
**拒绝 DRY_RUN 占位地址**（`dry-run.invalid` → 422）；`url` 返回落库后的可访问地址，`source_url` 单独保留来源。

实测链：采纳 → 资产页刷新可见 → 成为定版 → 下一次「垫图批量」计划读到的**就是采纳落库的那张**（两个 URL 完全一致）。

### ④ 绑定素材进入导出内容与实际生成请求 —— 图片已完成；声音**仅完成导出侧**

图片侧（已证）：

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"frame_type":"first","prompt":"起始画面：韩虹把邀请函放在桌上","images":[]}' \
  http://127.0.0.1:8000/api/v1/studio/image-tasks/shot/script_3cdc1b751a_EP01_SHOT_002/frame-render-prompt
# images   = ['mig-file-e910227a0db80425'(韩虹定版), 'mig-file-f31c6e478cd95c11'(场景)]
# mappings = ['韩虹', '国家文工团总部办公室']
```

声音侧（导出内容已证，实测交付文本片段）：

```
【绑定素材·实际文件】
角色：韩虹[定版] file_id=mig-file-e910227a0db80425
场景：国家文工团总部办公室[fallback] file_id=mig-file-f31c6e478cd95c11
声音：验收示例音频·韩虹台词（静音占位，可删）[shot_detail.audio_file_id] file_id=182e1abe-…
```

**未完成**：声音进入**实际视频生成请求**。当前 `app/core/contracts/video_generation.py` 只有首尾帧等画面参数，**没有音频字段**；要让声音进生成请求必须改这个契约（属"核心契约变更"，按规则需要你确认）。

## 三、付费出口统一守卫 —— 已完成

| 出口 | 接线位置 |
|---|---|
| 大模型（legacy） | `/api/v1/script-processing/*` router 级守卫（20 条路由全覆盖） |
| 大模型（构造点） | `services/llm/resolver.py`、`services/llm/runtime.py` —— 构造即拦，worker / 技能路径同样受限 |
| 出图 | `services/studio/image_task_runner.py::create_image_task_and_link`（studio 出图建任务唯一入口，写库前拦） |
| 出视频 | `/api/v1/film/tasks/video` |
| 兜底 | `app/tasks/execute_task.py::run_task_celery`：绕过接口层建出的任务直接标 failed，不进执行器 |

实测：`/script-processing/divide` 与 `/film/tasks/video` 均返回 **409**（`[DRY_RUN] 已拦截…`），`generation_tasks` 行数**不变**（141 → 141）。

## 四、第 2 步真实付费提取（已获授权，已完成）

2026-09-18 用户授权「真实跑第 2 步」后执行：

- **调用方式**：另起一个临时进程 `uvicorn --port 8001` 并带 `JELLYFISH_DRY_RUN=0 JELLYFISH_REAL_LLM_CONFIRMED=1`；
  主服务 `:8000` **全程守闸**（跑完即关闭临时进程，:8000 仍返回 409）。
- **为什么分批**：`ElementExtractorAgent` 一次调用要输出「全局实体表 + 逐镜关联 + 对白 + 动作拍点 + 镜头语言建议」，
  64 镜一把梭会超过 deepseek-chat 默认 `max_tokens`(4096) 被截断；按 **8 镜一批**顺序调用，逐批落库
  （`replace_for_shot` 按镜头替换，天然幂等）。脚本：`/tmp/dsh_ui/run_step2_extract.py`，日志 `/tmp/dsh_ui/step2_extract.log`。
- **结果**：**8/8 批成功，0 失败**，单批 8–18s；`shot_extracted_candidates` **0 → 294 行，覆盖 64/64 镜头**
  （character 106 / costume 98 / prop 26 / scene 64，全部 `pending` 待人工确认）；
  `shot_extracted_dialogue_candidates` **→ 50 行，覆盖 40 镜**。
- **审核接口实测**：`GET /chapters/{id}/asset-candidates` → 294 候选聚合成 **80 组**
  （可挂到已有资产 15 组、建议新建 65 组）；`GET /shots/{id}/assets-overview` 已把候选与已有绑定合并
  （`source= candidate / both / linked`）。
- **第 5 步 UI 实测**：工作室「关联绑定 → 资产绑定」点「AI 推荐资产关联」→ `候选资产数 27`，给出 4 条建议
  （DRY_RUN 下明确标注"未调用大模型、仅启发式"）。
- **顺带被改写的字段已还原**：该端点的既有行为会把草稿里的镜头语言默认建议回写 `shot_details`
  （`_apply_detail_defaults_from_shot_draft` 是无条件赋值）。本次实测改动了 64 镜中的
  `camera_shot 20 / angle 15 / movement 26 / duration 52`（全是**覆盖已有值**）→ 已按运行前快照**还原 54 行**；
  新增的 `action_beats`（64 镜，原本为空）**保留**。运行前后快照：`/tmp/jellyfish.db.before_cleanup_145615`（运行前）、
  `/tmp/jellyfish.db.after_step2_real_run_*`（运行后）。

## 五、断点④·声音侧：按官方协议对齐（已修正第一版结论）

**第一版结论是错的**：我当时只读了本地 `apimart/video_payload.py` 的字段清单注释，
得出"APIMart 没有音频输入字段"。用户贴出官方文档后核实——**seedance 支持参考音频**，
字段名是 ``audio_urls``。已按文档重做（文档：`https://docs.apimart.ai/` seedance-2.0 视频生成页）。

### 官方协议要点（本次实读）

| 字段 | 语义 | 约束 |
|---|---|---|
| `generate_audio` | 视频带 AI 生成的配套音频 | **默认 true**；与我们上传的配音无关 |
| `audio_urls` | **参考音频**（数组） | 最多 3 条、总时长 ≤15s、需与参考图/参考视频一起用、**只收公网 URL 或 `asset://`**、**与首尾帧图片互斥** |
| `duration` | 时长 | 正文写 4~15s，但同页"与 1.5 Pro 差异"表写 5-15s（**文档自相矛盾**，我们按 5 保守处理） |
| `resolution` | 分辨率 | 默认 720p；1080p/4k 仅标准版支持（mini 仅 480p/720p，与我们能力表一致） |

### 实现（已按协议重做）

- 契约 `VideoGenerationInput`：`generate_audio`（开关）+ **`audio_urls`（数组，字段名与协议一致）** +
  `audio_source_file_id`（仅追溯，绝不发出去）；原来自造的 `audio_url` 单数字段已删。
- 能力表：APIMart seedance 声明 `supports_audio_input=True`，并记录 `max_audio_inputs=3`、
  `max_audio_seconds=15`、`audio_input_requires_reference=True`、`audio_input_conflicts_with_frame_roles=True`。
- APIMart 请求体：发 `audio_urls`（超 3 条自动截断），**绝不发 base64**（不是协议入参形式）。
- 接线（legacy 路由 + P3 `submit_video` 两条路径）：
  - 只有**公网绝对地址**才进入 `audio_urls`；
  - 地址是本地/相对（本项目实测 `/files/files/acceptance_voice.mp3`）→ **不静默丢弃**，
    明确提示"供应商抓不到，要真正提交需要把音频放到公网可达位置（OSS 公网地址或配置
    `local_storage_base_url`），或改用 `asset://` 通道"；
  - 同时带了首/尾帧时会附一条**互斥冲突提示**（官方警告：使用首尾帧图片时参考音频不可用），
    不静默改写用户的入参；
  - 音频是尽力而为的输入，任何异常都只降级为提示，不阻断出视频。
- 前端「声音绑定」区块的文案已按上述事实改写（旧文案里"provider 不支持音频"的说法已删）。

### 测试

`tests/test_video_audio_input.py`（12 条）+ 路由级 1 条：契约字段、能力声明、
`audio_urls` 按协议发出且 base64 不发、超 3 条截断、**本地相对地址被拒并给出可执行建议**、
公网地址成功进入 `audio_urls`、首尾帧冲突提示、无绑定不产生噪音、供应商不支持时的提示。

### 仍然需要的前提（不是代码问题）

1. 音频要有**公网可达地址**：当前 Jellyfish 用本地存储驱动且未配 `local_storage_base_url`，
   实测音频解析为 `/files/files/acceptance_voice.mp3` —— 供应商抓不到。需要把音频放到 OSS
   或给本地存储配一个外部可达的基址（此前实测本项目 OSS 上传返回 403，未解决）。
2. 用参考音频时**不能同时用首尾帧图片**（官方互斥），需要按 `reference_mode=first` 之类
   的参考图方式使用。

## 五·补、真实出视频一次成功（2026-09-18，含参考音频）

用户授权并配合（上传 OSS 音频、修复代理）后跑通：

| 项 | 值 |
|---|---|
| 结果 | **completed**，耗时 122,431 ms |
| provider 任务号 | `task_01M2TA8M1JDVK236Y0DAPEEHR5` |
| 视频地址 | `https://getapib.org/video/…-video_task_01M2TA8M1JDVK236Y0DAPEEHR5.mp4`（HTTP 200 / 1,366,042 B / video/mp4）|
| 参数 | `seedance-2.0-mini` / 480p / **5s（最短）** / 16:9 / 参考图 1 张 + **参考音频 1 条** |
| 落库 | 登记为素材 `5c4f14d3-…`（external video）并挂到 `shot.generated_video_file_id`；镜头回到 `ready` |
| 帧图 | `shot_frame_images(frame_type=first)` → 公网图 `mig-file-e910227a0db80425` |

### 过程中修掉的三个真 bug（都是"注定失败"级别的）

1. **APIMart 不接受 base64 data URL**：实测报错
   `Invalid format for first_frame_image. Only http/https URLs or asset:// private asset URLs are supported.`
   而我们此前把所有参考图都转成 data URL → **只要带帧图就必 400**（早先那次成功是因为当时没有帧图，纯 prompt）。
   现在 `file_id_to_data_url` 对**公网 storage_key 直接透传**（库里 56 张图本来就是 OSS 地址），
   APIMart 适配器对 data URL **本地就拒绝**并给出可执行建议（先放公网 / 用 `files/external` 登记）。
2. **首尾帧与参考音频互斥**：同时发 `first_frame_image` + `audio_urls` 被直接 400。
   现在有音频时自动把首/尾帧改以 `image_urls` 提交（官方文档场景 2/9 的形式），并写成 warning 说明代价（尾帧不再是严格结束帧）。
3. **轮询失败会丢掉 provider 任务号**（付费出口必须可追）：现在异常里带上
   `provider_task_id=…`，用户可去供应商后台按号取回产物。

### 结论（2026-09-18 实验）：`generate_audio` 决定**成片有没有音轨** —— 这个结论成立

同一个镜头、同样带 `audio_urls`（用户的 `你以为配音.mp3`）与公网参考图，只改 `generate_audio`：

| 产物 | `generate_audio` | 轨道（解析 MP4 box） | 时长 |
|---|---|---|---|
| `task_01M2TA8M1JDVK236Y0DAPEEHR5` | 未传（官方默认 **true**） | `vide` + **`soun`** | 5.1s |
| `task_01M2TDA5XT6QMPNE49RGJHSDTE` | **false** | **只有 `vide`（无音轨）** | 5.0s |

→ 可以确定的只有一件事：**`generate_audio=false` 时成片没有音轨**。

### 更正（2026-09-19）：上一条我写成「参考音频**不会**成为成片音轨」——**这个结论下过了头，撤回**

用户当场质疑（"你不要随便下结论，现在 seedance 是明确可以参考音频到"），重查公开资料后确认**用户是对的**，
我那次实验**不足以**支撑那个结论：

1. **官方（火山方舟 · 创建视频生成任务 API）**：seedance 2.0 / 2.0 fast 的能力是
   **多模态参考生视频 —— 参考图片 0~9 + 参考视频 0~3 + 参考音频 0~3 + 文本提示词**；
   音频的位置/用途字段 `role` 当前**只支持 `reference_audio`（参考音频）**，
   且明确写了「不可单独输入音频，应至少包含 1 个参考视频或图片」。
   参数约束：wav/mp3、单段 2–15s、最多 3 段、总时长 ≤15s、单文件 ≤15MB。
   来源：[火山方舟 创建视频生成任务 API（docs.ksyun 镜像同样写明）](https://docs.ksyun.com/documents/45628?tpl=scaling&type=3)、
   [同页可检索版本](https://raw.githubusercontent.com/sihuangtech/seedance-studio/main/%E5%88%9B%E5%BB%BA%E8%A7%86%E9%A2%91%E7%94%9F%E6%88%90%E4%BB%BB%E5%8A%A1API.md)
2. **`generate_audio` 是输出侧开关**（默认 true）：控制成片是否包含与画面同步的声音；
   官方原话是模型基于提示词与视觉内容**自动生成**人声/音效/背景音乐。
   它和"输入侧的参考音频"是**两件事**——关掉它不能证明参考音频没被采用，只能证明"这次没有输出音轨"。
3. **参考音频能做什么**：公开的 seedance 2.0 reference-to-video 示例直接把音频参考当**唇形/说话内容**用
   （`@Audio1` 语法：`@Image1 speaks directly to the camera ... while saying @Audio1`，
   见 [fal-ai/seedance-2.0-api 示例 3](https://github.com/fal-ai/seedance-2.0-api/blob/main/examples/reference_to_video.py)、
   [Replicate seedance-2.0 模型页](https://replicate.com/bytedance/seedance-2.0/readme)）。
   也就是说参考音频走的是"多模态参考输入"这条路（音色/口型/说话内容），
   **不是**"把我的 mp3 原样混进成片音轨"。
4. **我那次请求的缺陷**：prompt 里**没有**引用音频（没有 `@Audio1` 一类指代），
   所以即便 `audio_urls` 被供应商接受，模型也缺少"用这段音频做什么"的显式指示 —— 据此评价参考音频的能力是不成立的。
   实测音轨与原始 mp3 包络相关系数仅 +0.18~0.23，与第 4 点一致，但同样不能反推"参考音频无效"。

**结论改为（未证实，而非否定）**：
- 参考音频**是被官方支持的输入**，语义是"参考"（音色/口型/说话内容），不是"原样混音"；
- "让上传的配音**逐字**成为成片音轨"**目前既没被证实、也没被证伪**——要证实需要一次决定性实验：
  prompt 写成 `@Audio1 说："…"`（显式指代）→ 带 `audio_urls` + 参考图 → `generate_audio=true`
  → 再把成片音轨与参考 mp3 做内容/包络比对（一次真实出视频 ≈0.53 credits，需用户授权）。

顺带：`generate_audio` 现在可从直提端点传（`POST /studio/image-pipeline/video-submit` 的 `generate_audio` 字段），
便于按需开/关并做对照实验。

### 早期（非决定性）观察——保留备查

- 请求里**确实带了** `audio_urls`（= 用户的 `你以为配音.mp3`），供应商**接受**了该请求（没有再 400）；
- 产物**有音频轨**（MP4 双轨：`vide` + `soun`，时长 5.1s）；
- 但把音轨解出来跟原始 mp3 比包络，相关系数只有 **+0.18 ~ +0.23**（对齐后 +0.23）——
  在 prompt 没有 `@Audio1` 指代的前提下，这既不能证明、也不能否证参考音频被采用。

## 五·补2、工作室两处可用性修复（用户实点反馈，2026-09-18）

用户反馈：「视频提示词页面没有视频提示词，点编辑跳到无关页面」。核实后是三个问题叠加：

1. **视频提示词不在第 4 步里**：那内容原本只存在于「6. 生成与交付 → 视频生成」页签的弹窗里，
   第 4 步只有「生成参数 / 确认诊断」两个页签 —— 用户在本步骤根本看不到提示词。
   **修**：第 4 步新增「视频提示词」页签并设为默认：显示已保存内容（来源标签 / 字数 / 交付读的就是
   `shot_details.video_prompt`）+ **就地可编辑**（TextArea）+「保存到镜头」（固定记 manual）+
   「填入本次生成结果」+「还原为已保存内容」，全程不跳页。
   实测：输入 52 字 → 保存 → DB `video_prompt_source='manual'` → 刷新后仍在、编辑器回填。
2. **右侧检查器默认是折叠的**：工作室的步骤内容全在检查器里，而"无视频才自动展开"的旧规则在
   镜头都 `ready`、视频已生成后判定为"不需要展开"，于是用户进来看不到任何步骤界面，只能点到别处。
   **修**：进入工作室时若折叠则自动展开一次（用户之后仍可手动收起）。
3. **「生成」按钮点了不会真跑**：原走 `/film/tasks/video` → Celery 队列，而本机无 Redis / worker
   （`task_always_eager=False`），任务停在 pending。**修**：改走同进程内联的
   `/studio/image-pipeline/video-submit`，成功后自动 `files/external` 登记 + 写
   `shot.generated_video_file_id`（刷新可见、交付可读）；DRY_RUN 下明确提示"演练模式、未花费"而不是报红。
   实测：界面点击 → `POST /studio/image-pipeline/video-submit → 200`（DRY_RUN 下无消费）。
4. 顺带：`files/{id}/download` 对外链素材**307 重定向**到源地址（此前一律按本地路径读 → 外链必 500，
   界面播放器放不出来）；并把那条真实视频下载成本地副本（`generated-videos/shots/….mp4`）以便直接播放。

## 六、第 2 步候选批量确认（已执行，2026-09-18）

口径 = 用户既有指示「重复的不接线、只补增量」+ 官方文档（`site/content/docs/guide/shot-page-boundary.md`
「资产候选：关联 / 新建 / 忽略」）：

| 处理 | 组数 | 说明 |
|---|---|---|
| **关联**已有同名资产 | 14 组 | 角色：许晨 / 姜岁欢 / 秦老夫人 / 韩虹 / 苏紫沫；道具：拐杖 / 化妆镜 / 节目邀请函 / 吉他 / 曲谱 / 屏幕；场景：国家文工团总部 / 办公室 / 练习室 |
| **新建**资产 | 64 个 | 角色 12（林山、王奋、伊莎贝拉、亚瑟、歹徒…）、场景 23、道具 12、服装 26 |
| **忽略**（判定为非资产） | 5 组 | 系统提示光点 / 系统文字 / 资本符号 / 盗版网站界面（画面特效与意象，应记在镜头 vfx 字段）；庭院（与已有 SCENE_将军府庭院 不是同一处，本集是秦家庭院）|

执行方式：脚本 `/tmp/dsh_ui/confirm_candidates.py`，全部走既有 HTTP 端点（不直接写库），
每组失败不影响其它组；服务端每次自行重算 `shot.status`。

**结果**

| 指标 | 前 | 后 |
|---|---|---|
| 资产候选 | 294 pending | **289 linked + 5 ignored，0 pending** |
| 对白候选 | 50 pending | **50 accepted** |
| EP01 镜头状态 | 64 pending | **64 ready** |
| 本集镜头绑定 | 角色 39 / 场景 约 25 / 道具 4 / 服装 0 | **角色 75 / 场景 99 / 道具 29 / 服装 98** |

界面复核（截图 `/tmp/dsh_ui/after_confirm_*.png`）：
- 第 2 步：`本集提取候选（第 2 步产物，已确认）· 候选 289 条 · 聚合 75 组 · 已确认 289 条`
- 第 5 步：`共 64 镜 · 已绑定资产 64 · 已绑声音 1 · 绑定已齐`，分镜列表徽标 `待确认 0 / 已就绪 64`，
  当前镜头提示「镜头已具备视频生成前置条件」
- 第 6 步：`可交付 28 条 / 跳过 36 条 / 带出绑定素材 是`，视频准备度面板显示「可生成」

**可回退**：执行前备份 `/tmp/jellyfish.db.before_confirm_v2_*.db`；新建资产 id 清单
`/tmp/dsh_ui/created_assets_after_confirm.txt`（含原有资产，按需筛选）。候选行只改状态、不删除。

**操作注意（踩过的坑）**：SQLite 在 WAL 下，用**同一个** python 连接先读后写再读，可能读到旧快照，
一度让我误判「关联没写进去」。核对写入请用**新进程/新连接**，或直接以界面为准。

## 七、找到的两份「关联资产」权威文档

1. `site/content/docs/guide/shot-page-boundary.md`（分镜页面职责边界）——**在哪关联**：
   `ChapterShotEditPage` 负责「资产候选：关联 / 新建 / 忽略」「对白候选：接受 / 忽略 / 批量接受 / 批量忽略」，
   目标是 `shot.status=ready`；`ChapterStudio` 只做生成与诊断，候选确认给「去分镜编辑确认」。
2. `site/content/docs/guide/shot-status-flow.md`（分镜状态流转说明）——**关联的规则与状态**：
   候选生命周期 `pending → linked / ignored`（对白 `pending → accepted / ignored`）；
   `ready` 的判定规则里明确写着「**只要还有任意一条候选 pending，镜头就不能 ready**」；
   另有「路径 C：取消关联 / 替换 → 候选回退 pending → 状态重算」。

## 八、逐步取证（一次连续点击走完六步）

**声音进实际视频生成请求**：需要改 `app/core/contracts/video_generation.py` 增加音频字段并打通 provider 侧
（当前契约只有首尾帧等画面参数）。声音目前已经进入**交付内容**（见 §二④）。


脚本 `/tmp/dsh_ui/final_six_step_walkthrough.py`：从 `/projects` 项目列表点进目标项目，再依次点六个步骤，
每一步断言「该步骤读到了上一环的产物」，并截图。最新结果 **6/6 通过**，报告 `/tmp/dsh_ui/final_walkthrough_report.json`：

| 步骤 | 断言片段（证明读到了真实数据） |
|---|---|
| 1 剧本 | `章节列表` / `EP01` / `64`（本集已有 64 条分镜） |
| 2 提取资产 | `韩虹` / `许晨`（项目资产已建立） |
| 3 图片准备 | `生图计划预览` / `用已保存提示词 1 条` / `目标 7 条`（断点① + 第 2 步资产） |
| 4 视频提示词 | `本集进度` / `有正文 41` / `来源已确认 28`（断点②） |
| 5 关联绑定 | `本集进度` / `已绑定资产 36` / `已绑声音 1`（断点④ 输入侧） |
| 6 生成与交付 | `本集进度` / `可交付 28 条` / `带出绑定素材 是`（断点④ 输出侧） |

**本轮修掉的一个可达性缺口**：第 4-6 步的工作台导航会**直接跳进工作室**（主流程该有的速度），
因此原先放在工作台上的三块进度面板只有直接打开 `?step=...` 深链才看得到——等于死面。
现在把「本集进度」压缩成一行放在**工作室步骤切换器下面**（`StudioStepProgressStrip`），
按当前步骤显示对应口径，并带「复制交付文本」；切步骤会跟着变。工作台那三块面板保留（深链/返回修改时仍可见）。

## 九、第 2 步的产物概览

真实跑过第 2 步之后，`shot_extracted_candidates` 有 **294 条 → 聚合 80 组**，但工作台第 2 步此前只显示"已建立的资产"，
用户看不到"还有多少候选等着确认、哪些能直接挂已有资产"。现在第 2 步顶部加了一条**只读**折叠概览
（`ProjectExtractCandidatesPanel`，数据来自 `/chapters/{id}/asset-candidates`，不建资产、不写库、不触网）：

```
本集提取候选（第 2 步产物，待确认）  候选 294 条 · 聚合 80 组 · 可挂已有资产 15 组 · 需新建 65 组
 候选            出现镜头   对账结果                    关联状态
 人物 许晨        24 镜     可挂已有资产 CHAR_许晨_2      已进项目 / 未绑镜头
 人物 林山         9 镜     尚无同名资产（需新建）         未进项目 / 未绑镜头
 ...
```

默认收起（80 行展开会把下面的资产网格顶下去），点标题展开。确认动作仍由人在工作室「资产绑定 / 确认诊断」里做——
这个面板只摆事实，不代替决策。

## 十、出视频出口的入参预检（付费前最后一道检查）

`/api/v1/film/tasks/video` 此前**完全不做出参校验**（`validate_apimart_video_options` 写了但零调用），
而本项目镜头时长普遍是 3–4s，`seedance-2.0-mini` 的 `min_seconds=5`。后果是：任务建出来 → 真花钱发出请求 →
被供应商拒绝。现在在建任务**之前**做确定性预检（`validate_legacy_video_input`）：

| 情况 | 行为 |
|---|---|
| `seconds < 5`（如 3s/4s） | 钳到 **5s** 并把 warning 放进响应 `meta.video_option_warnings` |
| `seconds > 15` | 钳到 15s + warning |
| 未指定分辨率 | 补成固定档 **480p**（mini 支持的最低档，最省）+ warning |
| 分辨率/比例不在能力表内 | **422** 拒绝，不建任务（测试已断言 `db.added == []`） |
| 模型不是 `seedance-2.0-mini` | 放行但 warning 提示与固定策略不一致 |

顺序上**守卫在最前面**：DRY_RUN 下依然先 409、不建任务（实测 3s 镜头也是 409、`generation_tasks` 不变）。

## 十一、收口验证（只读，可重跑）

最终一轮跑了一遍**只读**收口检查（不写任何数据），**14/14 通过**：

| 检查 | 结果 |
|---|---|
| DRY_RUN 默认开启、未确认真实调用；出口清单 llm/image/video/oss | PASS |
| 九槽位定义可读（前端手工填写表单依赖它） | PASS |
| legacy 大模型出口 409 / 出视频出口 409，且**不建任务行**（141→141） | PASS |
| 断点① `prompt_source = saved`（韩虹的已保存提示词） | PASS |
| 断点② 绑定预览在 DRY_RUN 下明确标注未调用模型 | PASS |
| 断点③ 资产图片槽位可读回（刷新后仍在，定版图正确） | PASS |
| 断点③ 演练占位地址采纳被 422 拒绝 | PASS |
| 断点④ 帧图生成请求参考图 = 绑定资产定版图（韩虹 + 场景） | PASS |
| 断点④ 交付行带出声音 file_id | PASS |
| 断点④ 交付清单可读（可交付 28 / 跳过 36 / 共 64 镜） | PASS |
| 第 2 步真实产物仍在（294 条候选 → 80 组，64/64 镜） | PASS |

同轮复跑六步逐步取证脚本：**6/6 通过**，无 JS 错误。

## 十二、本轮验收用到的脚本与截图（可直接重跑）

| 产物 | 路径 | 说明 |
|---|---|---|
| 六步链路验收（HTTP 层 27/27） | `/tmp/dsh_ui/acceptance_chain.py` | 会**写**真实数据，跑完请按 §六 还原 |
| 验收结果 JSON | `/tmp/dsh_ui/acceptance_report.json` | 27 条逐项结论 |
| 六步导航截图 | `/tmp/dsh_ui/six_0_lobby.png` … `six_7_generate_deliver.png` | 从项目列表出发 7 张 |
| 工作室三步截图 | `/tmp/dsh_ui/studio_A/B/C*.png` | 含刷新后保持、当前分镜保留 |
| 声音绑定 UI 截图 | `/tmp/dsh_ui/audio_A…D*.png` | 已绑定 / 素材库弹窗 / 上传绑定 / 刷新后仍在 |
| 第 3 步断点①截图 | `/tmp/dsh_ui/step3_A…F*.png` | 保存前 0 条 → 保存后 1 条 → 刷新仍 1 条 |
| 第 4/5/6 步进度截图 | `/tmp/dsh_ui/progress_step4/5/6.png` | 只读进度面板 |
| 第 2 步真实提取脚本 | `/tmp/dsh_ui/run_step2_extract.py` | 分批真实调用 `/script-processing/extract`（**会花钱**） |
| 真实提取运行日志 | `/tmp/dsh_ui/step2_extract.log` | 8 批逐批结果 |
| 关键帧计划面板 + 演练点击截图 | `/tmp/dsh_ui/keyframe_plan_panel.png`、`keyframe_dryrun_click.png` | 面板五项标签齐全；点击给"演练模式"提示 |
| 关键帧「保存到镜头」往返 | `/tmp/dsh_ui/keyframe_saved_A_before.png`、`_B_saved.png`、`_C_reopened.png` | 保存 → 刷新 → 重新打开读回（来源变 saved） |
| 关键帧往返脚本 | `/tmp/dsh_ui/keyframe_save_roundtrip.py`、`keyframe_plan_ui.py` | 可重跑（DRY_RUN 下不花钱） |
| 真实关键帧产物与界面 | `/tmp/dsh_ui/real_frame_result.json`、`keyframe_real_in_ui.png`、`keyframe_model_selector.png` | 出图通道可选；真实产物截图 |
| 真实产图（本地副本） | `backend/storage/generated-images/shot_frame_image/2/*.png` | 2048×1152 PNG，界面缩略图即它 |
| 第 2 步候选被第 5 步读取 | `/tmp/dsh_ui/step2_A_binding_panel.png`、`step2_B_recommend.png` | 候选资产数 27、4 条建议 |
| 六步逐步取证脚本/报告 | `/tmp/dsh_ui/final_six_step_walkthrough.py`、`final_walkthrough_report.json`、`final_*.png` | 6/6 通过 |
| 第 2 步候选概览截图 | `/tmp/dsh_ui/step2_candidates_overview.png`、`step2_candidates_expanded.png` | 294 条 → 80 组 |
| 候选批量确认脚本 | `/tmp/dsh_ui/confirm_candidates.py` | 关联/新建/忽略 + 对白接受（走 HTTP 端点）|
| 确认后界面截图 | `/tmp/dsh_ui/after_confirm_A_candidates.png`、`_B_binding.png`、`_C_deliver.png` | 已确认 289 / 绑定已齐 / 可生成 |

## 十三、本轮对真实数据做过什么（以及怎么还原）

- **保留 1 条**：韩虹的 `image_prompts.character_image_front` = `韩虹，35岁女歌手，齐肩黑发，米色长裙，气质温柔坚定，正脸半身像，柔和主光，纯白背景，高清写实`（让第 3 步有真实进度可看，删掉即可）。
- **保留 1 条**：音频素材 `验收示例音频·韩虹台词（静音占位，可删）`，绑定在 `script_3cdc1b751a_EP01_SHOT_002` 的 `audio_file_id` 上（声音绑定 UI 的可见样例，删掉即可）。
- **保留 1 条真实产物（2026-09-19，花钱出的）**：SHOT_001 的关键帧
  `shot_frame_images(id=2, frame_type=key).file_id = 646fdae9-671a-4fc3-8905-77f9682f49b2`
  （本地副本 `backend/storage/generated-images/shot_frame_image/2/427d89a2aab548bdb40f2b1e731d11a1.png`，
  2048×1152 / 2.9 MB；供应商 APIMart `task_01M2TK624XJ19ZS90RE0XG0YX1`）。
  不想要就删这一行、顺带删对应 files 行、file_usages 行与磁盘文件。
- **新增 1 条（2026-09-19）**：`script_3cdc1b751a_EP01_SHOT_001` 的 `shot_details.key_frame_prompt`
  = `韩虹站在舞台中央，齐肩黑发，米色长裙，暖色聚光灯，中景平视，电影质感，写实`（37 字，
  用来实测「保存到镜头 → 提交读的是这条」；在关键帧弹窗里清空再保存即可改回，或直接置空）。
- 其余验收写入（镜头视频提示词与来源、定版图槽位、验收新增的场景绑定、验收产生的 files 记录与磁盘图片）**均已还原**；数据库改动前的备份在 `backend/jellyfish.db.backup_before_*`，清理前快照在 `/tmp/jellyfish.db.before_cleanup_*`。

## 十四、门禁

- 后端：`cd backend && uv run pytest -q -p no:cacheprovider` → **546 passed / 16 failed**（这 16 条是另一条未提交功能线原有失败：`meta: None` 信封与 `task_executor.reset_db_runtime` 缺失）。
- 前端：`npm run typecheck && npm run build` → 通过。
- `uv run pylint app` → 本次改动模块 10.00/10。

## 十五、关键帧生成接进可执行路径（用户：**关键帧继续做啊**，2026-09-19）

### 问题：关键帧按钮点下去**注定没有任何结果**

`POST /studio/image-tasks/shot/{shot_id}/frame-image-tasks` 只做两件事：过守卫 → **建一条 Celery 任务行**
（`create_image_task_and_link` → `enqueue_task_execution`）。本机没有 Redis / celery worker 且
`task_always_eager=False`，所以要么被 DRY_RUN 守卫 409 拦下，要么停在「排队中」永不执行。
**并且**：这条路的参考图解析还有一个真 bug（见下）。

### 顺带查出的真 bug：绑定了资产图就必 400

`resolve_reference_image_refs_by_file_ids` 把 `storage_key` **一律当成本地相对路径**，
而库里大量图片（含我们采纳到韩虹槽位的那张）的 `storage_key` 本来就是 **OSS 公网地址**。
于是拼出 `backend/storage/https:/ai-shortdrama-assets.oss-cn-beijing.aliyuncs.com/…` 这种必然不存在的路径：

```
POST /studio/image-tasks/shot/script_3cdc1b751a_EP01_SHOT_001/frame-image-tasks
→ 400 Failed to download file for file_id=mig-file-0d5d3b4b9959d9c1: [Errno 2] No such file or directory:
  '/…/backend/storage/https:/ai-shortdrama-assets.oss-cn-beijing.aliyuncs.com/assets/…png'
```

**修**：把「公网地址透传 / 本地路径转 data URL」的判断抽成公共实现
`app/utils/files.py:file_id_to_image_ref`（视频那条路先修过同一个坑，现在两条路共用一份），
并新增「坏图只降级为 warning、不拖垮整批」的 `resolve_reference_refs_with_warnings`。

### 新增：同进程内联的关键帧端出图端点

| 端点 | 作用 |
|---|---|
| `POST /api/v1/studio/image-pipeline/frame-plan/preview` | **只读**：这一帧会用哪条提示词（`prompt_source`）、哪些参考图（只报**真的解析得出来**的）、什么画幅、哪个供应商 |
| `POST /api/v1/studio/image-pipeline/frame-submit` | **同进程内联执行**：过守卫 → 建任务行（`enqueue=False`）→ 直接跑 `run_image_generation_task` → 落库 `shot_frame_images.file_id` + `file_usages` → 回读结果 |

四条硬约束都满足了：

1. **提示词来源准确**：`prompt_source` 三态 `saved`（镜头里 `shot_details.key_frame_prompt` /
   `first_frame_prompt` / `last_frame_prompt`）/ `request`（弹窗里本次输入）/ `empty`（没有 → 提交直接 **400**，不糊弄）。
2. **参考图计划＝实际**：计划里只报能解析成功的 file_id，并明确列出被跳过的；
   绑定资产的定版图（OSS 公网地址）现在**透传**而不是下载失败。
3. **结果落库**：成功即写 `shot_frame_images.file_id`（同一帧类型复用同一行，不重复建行）；
   返回 `file_id` / `image_slot_id` / 耗时给前端提示。
4. **演练不写正式产物**：DRY_RUN 下返回 `status: dry_run` 的计划（提示词、来源、参考图一应俱全），
   **不建任务行、不建 slot 行、不发请求**。

### 实测（DRY_RUN，端口 8001，只读验证）

| 调用 | 结果 |
|---|---|
| `frame-plan/preview`（SHOT_001 · key） | `prompt_source=empty` + 明确警告；参考图 4 张候选 → **只有 2 张可用**（另 2 张的本地文件不存在，逐条列出）；画幅 `16:9(default)` |
| `frame-submit`（带 prompt） | `status=dry_run`、`prompt_source=request`、`file_id=""`、`task_id=""` |
| `frame-submit`（无 prompt） | **400**：`镜头 … 没有可用的关键帧提示词：shot_details.key_frame_prompt 为空，且本次请求没有传 prompt` |
| 库变化 | `shot_frame_images` 1→1、`generation_tasks` 141→141、`generation_task_links` 17→17（**零写入**） |

### 前端接线（工作室第 4 步「关键帧与参考图」）【已更新：已完成】

> **【已更新 2026-09-21】** 本节涉及的「前端接线尚未完成」状态已结束：整集草稿前端已接入（刷新恢复 / 停止保留 / 只重试失败 / 租约防重复付费），并有真实验收证据。


- 「生成」弹窗顶部新增「**本次提交计划**」面板：提示词来源标签 / 字数 / 参考图张数 / 画幅 / 供应商 +
  与实际提交文本是否一致（一致＝绿、不一致＝黄并说明"本次按输入框提交，不会改镜头里的保存值"）。
- 生成按钮改走 `frame-submit`（内联），成功后自动刷新帧图列表与缩略图，提示带 `file_id` 与耗时；
  供应商/适配层的如实说明（例如垫片回传「参考图未透传」）用 warning 弹出，**不假装参考图一定生效**。
- 「批量生成」也切到内联端点：逐镜串行 + 每次进度提示（`进度 n/总数（成功 x，失败 y）`），
  因为单张关键帧是分钟级，必须让人看见走到哪了。
- 新增「**保存到镜头**」按钮（挨着「AI生成」）：把弹窗里的提示词写回
  `shot_details.first/key/last_frame_prompt` —— 这是"保存内容被下一步实际使用"在关键帧上成立的前提；
  没有它，输入框里的字刷新就没了，下一次提交又是空。

### 实测（GUI 实点，DRY_RUN，未花钱）

脚本 `/tmp/dsh_ui/keyframe_save_roundtrip.py` + `/tmp/dsh_ui/keyframe_plan_ui.py`：

| 动作 | 结果 |
|---|---|
| 打开「关键帧与参考图 → 关键帧图片 → 生成」 | 计划面板显示 `提示词来源：无（提交会被拒）`、参考图 2 张、画幅 16:9、供应商 `openai / image2`，并解释"本次会用输入框里的文本提交"（截图 `keyframe_saved_A_before.png`）|
| 输入 37 字 → 点「保存到镜头」 | DB `shot_details.key_frame_prompt` 由空变为该文本（新连接核对，见下）|
| 关弹窗 → **刷新页面** → 重新打开 | 面板变为 `提示词来源：镜头已保存 · 37 字`，绿色提示「下面输入框里的文本与镜头里保存的内容完全一致：提交读的就是这条」，输入框自动回填（截图 `keyframe_saved_C_reopened.png`）|
| 点「生成」（不填 prompt，走 saved 兜底） | `POST /studio/image-pipeline/frame-submit` → 200，`status=dry_run`、`prompt_source=saved`、提示词与保存的 37 字完全一致 |
| 库变化（整轮 GUI 操作后） | `shot_frame_images` 1→1、`generation_tasks` 141→141、`generation_task_links` 17→17（**只有那一个提示词字段被写入，其余零写入**）|
| 浏览器控制台 | 0 个 JS 错误 |

### 当时的两个待决项（都已在下一节处理）

1. **还没有跑过一次真实关键帧出图**（DRY_RUN 全程守着）。要证明"真的出图 + 真的落库 + 刷新后仍在"，
   需要关掉守卫跑一次：约 **0.14 credits**。**要不要现在跑？**
   提醒一句：因为垫片不透传参考图、且 OSS 403 让出图服务只能给本地 `/images/…` 地址，
   这一张会是**纯文生图**（但会真的落进 `shot_frame_images.file_id`，界面可见）。
2. **参考图是否真的影响画面取决于供应商适配层**：当前图片模型 `image2` → 供应商 `prov-image-tool` →
   `http://127.0.0.1:4321/v1`（OpenAI 垫片）→ 出图服务 `127.0.0.1:4173`。
   垫片自己的 `KNOWN_LIMITS` 写明 `/images/edits` 的 `images[]` **目前无法透传**（服务端参考图字段要的是它本地图片路径），
   所以**这次请求哪怕带了参考图，出图服务收到的仍是纯文生图**。这一条现在会通过 `provider_notes`
   如实回传到界面，不会再"假装一致性没问题"。
   要让参考图真的生效，只有两条路：a) 出图服务支持"公网 URL 参考图"（要改它的业务代码，需你点头）；
   b) 换成直接调 APIMart 图片接口并把参考图以公网地址送出去（`file_id_to_image_ref` 已经会透传公网地址）。

## 十六、真实关键帧出图成功（2026-09-19，用户授权）

用户选择：**跑一次真图** + **参考图走"直连 APIMart 图片接口"**（不动出图服务）。

### 先修的一处真问题：APIMart 图片适配器原来只是 OpenAI 的空壳

`app/core/integrations/apimart/images.py` 原先 `class ApimartImageApiAdapter(OpenAIImageApiAdapter)`
一句就完事 —— 意味着只要图片供应商切到 APIMart，就会拿 OpenAI 的 `/images/edits` + `images[]` 去打它：
**APIMart 没有这个路由，它的参考图字段叫 `image_urls`**。现已按**线上可用**的出图服务实现逐字段重写：

| 步骤 | 契约（照抄出图服务 `apimartImageProvider.js`） |
|---|---|
| 提交 | `POST {base}/images/generations`，body = `{model, prompt, n, size: "16:9", resolution: "2k", image_urls: [公网地址…]}` → `data.task_id` |
| 轮询 | `GET {base}/tasks/{task_id}?language=zh`，status ∈ `success/completed/done` 取图、`failed/…` 报错（异常里带任务号） |
| 比例 | 只支持 `1:1 / 3:4 / 16:9`（非这三档直接拒绝并说明） |
| 分辨率档 | `standard → 2k`、`high → 4k` |

（`size` 传的是**比例字符串**而不是 `1024x1024`；这是与 OpenAI 的第二个关键差别。）
测试：`tests/test_apimart_image_adapter.py`（7 条，全部 MockTransport，不联网），含"参考图必须走 image_urls、
绝不能出现 OpenAI 的 images[]"的回归断言。

### 真实跑的那一次（付费窗口：临时进程 `:8001`，`JELLYFISH_DRY_RUN=0` + `…CONFIRMED=1`，跑完立即 kill）

```
POST /api/v1/studio/image-pipeline/frame-submit
{"shot_id":"script_3cdc1b751a_EP01_SHOT_001","frame_type":"key",
 "model_id":"model-gpt-image-2","target_ratio":"16:9","resolution_profile":"standard"}
```

| 项 | 值 |
|---|---|
| 结果 | `status: succeeded`，耗时 **62.6 s** |
| 供应商 / 任务号 | `apimart` / **`task_01M2TK624XJ19ZS90RE0XG0YX1`** |
| 提示词来源 | **`saved`**（就是前面从界面保存的那 37 字，一字不差）|
| 参考图 | **2 张**，以 `image_urls` 送出（响应里写明：「已按 APIMart 契约用 image_urls 送参考图 2 张。」）|
| 产物地址 | `https://getapib.org/image/…-image_task_01M2TK624XJ19ZS90RE0XG0YX1.png`（临时地址）|
| 落库 file_id | **`646fdae9-671a-4fc3-8905-77f9682f49b2`**（已下载成本地副本：`generated-images/shot_frame_image/2/….png`，2048×1152 PNG / 2.9 MB）|
| 落库 slot | `shot_frame_images(id=2, frame_type=key)` |
| 任务/关联/用量 | `generation_tasks` 141→**142**（`succeeded`）、`generation_task_links` 17→**18**（`file_id` 已写）、`file_usages` 新增 `usage_kind=shot_frame` |
| 镜头状态 | 仍为 `ready`，本集 64/64 未被破坏 |
| 界面 | 「关键帧与参考图 → 关键帧图片」卡片的缩略图就是这张新图（截图 `keyframe_real_in_ui.png`），刷新后仍在 |

**必须说明的边界**：这一次确实把参考图送出去了（供应商 200、任务成功），
但**一张样本不足以证明"参考图影响了画面"** —— 要证明得做对照（同 prompt + 同参考图 vs 去掉参考图，比人脸一致性）。
现在的口径是"参考图**已经真的进了请求**"，不是"参考图一定生效"。

## 十七、出图落公网（OSS 403）你到底需要做什么（2026-09-19）

### 先把事实摆清楚（都来自出图服务自己存下来的原始报错）

出图服务 `GET /api/service/health` 显示 `oss: {configured: true, missing: []}` ——
**五个键都在**（`ALIYUN_OSS_ACCESS_KEY_ID/SECRET/BUCKET/ENDPOINT/PUBLIC_BASE_URL`），
所以不是"没配"，是**这个 AK 没有往这个桶写对象的权限**。原始 XML 报错（被服务截断到 500 字符）：

```xml
<Error>
  <Code>AccessDenied</Code>
  <Message>You have no right to access this object because of bucket acl.</Message>
  <RequestId>6AAD32E9F64A03303595DCFA</RequestId>
  <HostId>ai-shortdrama-assets.oss-cn-beijing.aliyuncs.com</HostId>
  <AccessDeniedDetail>
    <PolicyType>ResourceGroupLevelIdentityBasedPolicy</PolicyType>
    <AuthPrincipalOwnerId>1073595564225663</AuthPrincipalOwnerId>
    <AuthPrincipalType>SubUser</AuthPrincipalType>   ← RAM 子用户，不是主账号
```

时间线（出图服务 `data/db.json` 里 25 条有 `oss_url` 的成功记录 + 3 条 403）：

| 时间 | 结果 |
|---|---|
| 2026-07-12 | OSS 回填（backfill）跑过多轮，有成功记录 |
| 2026-09-16 11:18 | 403 **`UserDisable`**（EC `0003-00000801`）——那一刻这个 RAM 用户/账号是被停用的 |
| 2026-09-17 14:12 | **成功**（写出 `oss_url`）——最后一次成功 |
| 2026-09-18 03:18 / 12:46 | 403 **`AccessDenied` + `ResourceGroupLevelIdentityBasedPolicy`**（姜岁欢 / 韩虹两次真实出图） |

结论：**09-17 之后这个 AK 的写权限变了**（换了 AK / 改了 RAM 策略 / 策略被改成资源组级而没覆盖这个桶）。

### 你要做的（按顺序，约 5 分钟）

1. **登录阿里云控制台 → RAM 用户**：确认出图服务 `.env` 里那把 AK 属于哪个子用户
   （`AuthPrincipalOwnerId=1073595564225663` 是它所属账号），先看该子用户**是否被停用**
   （09-16 那次 `UserDisable` 就是停用态；若又出现，先启用）。
2. **给它一条能写这个桶的策略**（身份策略，自定义）：
   ```json
   {
     "Version": "1",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["oss:PutObject", "oss:GetObject", "oss:ListObjects", "oss:AbortMultipartUpload"],
         "Resource": [
           "acs:oss:*:1073595564225663:ai-shortdrama-assets",
           "acs:oss:*:1073595564225663:ai-shortdrama-assets/*"
         ]
       }
     ]
   }
   ```
   要点：**资源必须是这个桶的 ARN**；如果现在挂的是"资源组级"策略，而桶不在那个资源组里，
   就正好会得到上面这条 `ResourceGroupLevelIdentityBasedPolicy` 的 AccessDenied
   （参考：[阿里云 OSS HTTP 403 错误码](https://help.aliyun.com/zh/oss/user-guide/http-403-error-code)、
   [OSS 上传报 AccessDenied 的 RAM 权限排查实操](https://developer.aliyun.com/article/1755009)）。
3. **确认桶的地域与 endpoint 一致**：桶 `ai-shortdrama-assets` 在**华北2（北京）**，
   所以 `ALIYUN_OSS_ENDPOINT=oss-cn-beijing.aliyuncs.com`、`PUBLIC_BASE_URL=https://ai-shortdrama-assets.oss-cn-beijing.aliyuncs.com`
   （报错里的 `HostId` 已证明对得上，这一步只是别改错）。
4. **读权限保持现状**：桶当前是**公共读**（我们实测 `HTTP 200` 能直接取图），
   `GetObject` 是给控制台/垫片回读用的，保留即可；不要为了省事把桶改成"公共读写"。
5. **改完怎么验证**（任选其一，都不花钱）：
   - 出图服务界面里重跑一次 **OSS 回填**（它会把本地 `/images/*.png` 补传到 OSS）；
   - 或让我用同一把 AK 做一次极小的 `PUT`（写一个几百字节的探针对象，成功即删）——
     这属于"真实 OSS 写入"，我会先问你。
6. **修好之后立刻能白拿的收益**：出图服务里那批"出图成功但 OSS 上传失败"的图（`imageUrl=/images/…`）
   会变成 `oss_url`，从而**可以直接当 APIMart 的参考图/首帧用**（APIMart 只接受公网 URL）；
   我们这边的 `file_id_to_image_ref` 也就能把"公网地址透传"这条路走通。

### 在修好之前，仍然能出图的办法（已实测可行）

1. **手动放公网**：把图传到你的 OSS（`ai-shortdrama-assets`，华北2），拿到 `https://…` 地址；
   2. 在 Jellyfish 里把该地址**登记成素材**（`POST /api/v1/studio/files/external`，界面上的"外链素材"），
   3. 把它采纳/绑定到资产图片槽位或镜头帧图 —— 之后参考图解析就会**透传这个公网地址**。
   （音频那次就是这么走的：你手工上传 `audio/你以为配音.mp3` → 登记外链 → 进 `audio_urls`。）

## 十八、还缺什么（截至 2026-09-19，逐项已核实）

EP01 的真实覆盖度（直接查库，`script_3cdc1b751a::EP01` 共 **64 镜**）：

| 产物 | 有值的镜头数 | 说明 |
|---|---|---|
| 视频提示词（`video_prompt`） | **42 / 64** | 来源分布：`jurilu` 28、`manual` 1、**其余为空**；也就是说**没有一条是 LLM 生成的** |
| 帧提示词（`key/first/last_frame_prompt`） | **1 / 64** | 就是这次实测保存的那条 |
| 分镜帧图（`shot_frame_images` 有 file_id） | **1 / 64** | SHOT_001 的 key 帧（真实出图） |
| 已生成视频（`shots.generated_video_file_id`） | **1 / 64** | 真实出过一次 |
| 绑定声音（`shot_details.audio_file_id`） | **1 / 64** | 且是静音占位样例 |

### A. 挡在"走完六步拿到成片"路上的

1. **视频提示词批量生成没接**：第 4 步现在能就地编辑/保存/填入 LLM 结果，但**没有"给本集 64 镜批量生成并保存"的入口**；
   22 镜连正文都没有，来源为空的 35 镜点生成时后端没有任何提示词可用。
   （能力是有的：`POST /api/v1/studio/llm/video-prompt/preview`，但它在另一个页面里、只逐镜来。这属于新工作，且会花钱。）
2. **帧提示词批量生成没接**：63 镜没有帧提示词 → 点「生成」会被后端 **400** 拒绝（提示写得很清楚）。
   需要"按镜头描述 + 绑定资产批量产出帧提示词"，再接现有内联出图。
3. **整集出图/出视频的规模问题**：关键帧 1 张 ≈ 60 s、单镜视频 5 s ≈ 0.53 credits。
   64 镜全覆盖 ≈ 1–2 小时 + 约 34 credits（视频）。批量现在是**串行且不可中断**（只有进度提示）。

### B. 交付出口本身还不完整

4. **第 6 步的"交付"目前是只读清单 + 复制到剪贴板**，**没有"导出交付包"的落盘/下载出口**：
   全项目后端**没有任何** `FileResponse / StreamingResponse / ZipFile` 端点（已核实）；
   P3 `prompt-package` 只把 json/text/markdown **内容**回给前端，没有下载按钮。
   → 要真"交付"，还缺一个能把交付清单（提示词 + 绑定素材 + 视频地址）打成文件（或写 OSS）的端点。

### C. 工程欠账

5. **资产编辑页单张「生成」仍走死队列**：`assetAdapters.createGenerationTask` → `/studio/image-tasks/...` → Celery，
   本机没有 broker/worker ⇒ 和在关键帧上刚修掉的是**同一个病**（`AssetEditPageBase.tsx:278`）。
   同一页面里的「垫图批量出图」已经是可执行路径（P3 `submitImagePlan` + `adoptGeneratedImage`）。
6. **OSS 403**（见 §十七）：出图服务的出图结果落不了公网，`oss_url` 一直为空。
7. **门禁欠账**：后端 16 条失败（另一条未提交功能线：`meta: None` 信封 + `task_executor.reset_db_runtime`）；
   前端 eslint 155 条历史告警（`any` 之类，未动）。
8. **还没提交**：工作区 170 个文件有改动，其中**混着另一条功能线**；按 AGENTS 必须拆分后才能 commit（我没有替你提交）。
9. **两个"未证实"**：参考图是否影响画面（缺对照实验）、参考音频到底是音色/口型参考还是要后期合成（缺决定性实验）。

## 十九、把制作流程嵌进项目（2026-09-19，目标轮 1–2）

**先说来源**（用户要求）：EP01「64 镜」是**旧中控台迁移进来的历史数据**——
章节 `script_3cdc1b751a::EP01` 的行是 2026-09-17 15:26 迁移批次建的，但**64 条镜头自身
`created_at` 是 2026-06-13 ~ 06-16**（比 Jellyfish 这层早三个月），28 条 `video_prompt_source='jurilu'`
也是 2026-08 前后在旧系统里导的。因此**不再把 EP01 覆盖率当功能验收结论**，也不自动跑那 64 镜；
改用新建的 3–5 镜小项目做页面级验收（见 §二十，待执行）。

### 19.1 第 4 步：工作室里接上「真正的大模型生成」（已完成）

| 用户在哪点 | 得到什么 | 保存在哪 | 下一步是否自动读到 |
|---|---|---|---|
| 工作室 → 第 4 步「视频提示词」页签 →「大模型生成视频提示词」面板 | 范围单选（当前镜头 / 已勾选 N 镜 / 本集全部 N 镜）、只补缺失开关、生成/停止后续/重试失败项/保存全部 | 「保存到镜头」→ `shot_details.video_prompt` + `video_prompt_source='llm'` | 是：出口 A 交付导出与视频直提都读这一列 |

新增 `front/src/pages/aiStudio/chapter/components/VideoPromptLlmPanel.tsx`，调用
`/api/v1/studio/llm/video-prompt/preview`（**真的会调大模型**）。四条硬约束：

1. **默认只补缺失**：已有内容且来源在白名单（`jurilu / skill / llm / internal / manual / manual_workspace / shot_description`）
   的镜头**直接跳过**；实测「当前镜头（已有人工提示词）→ 计划生成 0 镜，跳过 1 镜」、
   「本集全部 → 计划生成 35 镜，跳过 29 镜（28 jurilu + 1 人工）」。要覆盖必须显式勾「连已有内容的镜头一起生成」。
2. **模板/演练不得冒充 LLM**：只认后端 `meta.llm_called === true` 才允许按 `llm` 来源保存；
   DRY_RUN 实测 → 标记「已生成」同时弹「有 1 条是演练结果（后端未调用大模型），不能保存为正式产物」，
   **保存按钮 disabled**；写库侧 `product_guardrails` 还会对占位文本 422 兜底。
3. **可编辑后确认保存**：每行文本域可改，再点「保存到镜头（来源：大模型生成）」。
4. **批量可控**：「停止后续」= 当前镜跑完即停、已完成结果保留；「重试失败项（n）」只重跑失败项。

### 19.2 第 3 步：资产图片提示词同样接上大模型（已完成）

新增 `front/src/pages/aiStudio/project/ProjectWorkbench/components/AssetImagePromptLlmPanel.tsx`，
嵌在第 3 步「图片准备」里（调用 `/api/v1/studio/llm/image-prompt/preview`；保存到
`<entities>.image_prompts[<type>_image_front]`，也就是生图计划实际读取的那一列）。

- **资产级选择**：表格多选 + 「全选缺失 / 清空选择」；**默认只勾前 3 个缺失资产**（几十个资产一键全跑＝一键烧钱）。
- **只补缺失**：已有 `image_prompts` 的资产不勾选、不生成。
- **超过 10 个资产先二次确认**（真实大模型调用按资产数计费）。
- **诚实标注**：槽位表只有角色/场景/服装，**道具没有大模型槽位** → 面板显式提示"有 18 个资产类型没有大模型槽位（道具）"，不拿模板顶上。
- 实测（DRY_RUN）：默认 3 个资产 → 生成 → 「已生成」+ 演练告警 + 保存 disabled，0 JS 错误。

### 19.3 资产单张生成修好（已完成，真实出图待验收）

原路径 `assetAdapters.createGenerationTask` → `/studio/image-tasks/...` → Celery 队列（本机无 broker/worker）
＝"点了生成没反应"，和关键帧当初同一个病。现在：

- 单张「生成」改走 P3 直提端点 `/studio/image-pipeline/submit`（**同进程内联执行**，`wait_seconds=120`），
  拿到地址后弹「生成结果」窗，给两个显式动作：**采纳到该槽位** / **采纳并设为定版**
  （走 `/studio/image-pipeline/adopt`，下载入库 + 写 `{type}_images.file_id` + `is_primary`）。
- 顺带清掉死代码：`AssetEditPageBase` 里那套 Celery 任务轮询 + 通知 + `createGenerationTask` prop
  （5 个 adapter 同步删除），不再留无效兼容代码。
- 实测（DRY_RUN）：点槽位「生成」→ 提交 200 → 界面给的是**演练提示**（"未真实出图，因此没有可采纳的图片"），
  不假装成功。真实出图 + 采纳 + 设版留到小项目验收时用少量样本跑。

### 19.4 第 6 步：接上已有 TXT 下载接口（已完成）

- 复用**既有**端点 `GET /api/v1/studio/prompt-delivery/{project_id}/export`（UTF-8 BOM，`text/plain` 附件），
  新增 `shot_ids` 查询参数支持**按选中镜头导出**（优先于 `chapter_id`；后端 3 条新测试锁住范围与优先级）。
- 工作室「本集进度」条在勾选镜头后变成「选中 N 镜进度」，并出现「**下载 TXT（选中 N 镜）**」按钮。
- 实测：勾 2 镜 → 标签变「选中 2 镜进度」、按钮变「下载 TXT（选中 2 镜）」、交付统计变「可交付 1 条 / 跳过 1 条」
  （不再是整集的 28/36）——**这同时满足"就绪状态按选中范围判定，不能一镜试通就显示整集已就绪"**。
- 直接调端点验证：TXT 内容含【巨日禄提示词】【绑定资产】【绑定素材·实际文件】
  （角色/场景/道具/服装各自带 `[定版]/[fallback]/[非定版]` 与 `file_id`，声音带 `file_id`），且**只含选中的镜头**。
- 明确不做：不新建写 OSS 的交付系统（按用户要求）。

### 19.5 只在 DRY_RUN 下验证过 / 尚未做的

- 上面 19.1–19.3 的"生成"都只在演练模式验证过 UI 与门禁；**真实大模型生成、真实出图与采纳**尚未跑（等小项目验收，少量样本、先确认）。
- 「本镜无需声音」的显式标记**尚未做**：需要在 `shot_details` 增加一个可空字段（数据库结构变更），要先经你确认。
- 绑定页"逐个展示实际图片与声音文件"只做到导出文本里（【绑定素材·实际文件】）；
  绑定面板内的可视化展示与"无需声音"选择还没接。

## 二十、小测试项目已开建（2026-09-19，全部走真实页面）

按用户要求：**不预置产物、不走调试台**，从项目列表开始点。

| 步骤 | 用户在哪点 | 得到什么 | 存在哪 |
|---|---|---|---|
| 建项目 | `/projects` →「新建项目」→ 填名称/简介/视觉风格/视频风格/**默认视频比例 16:9** →「创建并进入」 | toast「项目创建成功」，自动跳到新项目的第 1 步 | `projects` 表：`bd53bd4d-d8bf-4151-9bea-b1cae86b5683`「验收测试项目·小样本（3-5镜）」 |
| 建章节+贴剧本 | 项目第 1 步「剧本」→「创建第一章」→ 标题 + 粘贴 **4 镜短剧本** | 章节出现在列表 | `chapters`：`1bd1d100-7ae5-4df5-86ef-961aba2ff2f2`「第一集 雨夜咖啡店」（正文 136 字） |

剧本正文（4 个镜头段落）：
```
1 内景 咖啡店 白天 / 林小满推门进来，雨水顺着伞尖滴落。她望向角落里的座位。
2 特写 林小满的手 / 她握紧那只旧录音笔，指尖发白。
3 内景 咖啡店 角落座位 / 周迟把一杯热咖啡推到她面前："你迟到了三年。"
4 中景 两人对坐 / 林小满抬头，眼眶发红，却笑了一下。
```

**下一步需要你确认才能继续**：第 1 步的「AI 拆分镜」、第 2 步的「AI 提取资产」、第 3/4 步的提示词生成，
都走 `/api/v1/script-processing/*` 与 `/studio/llm/*` 的**真实大模型**出口（受付费守卫保护）。
按你的口径"真实 LLM 另行确认、少量样本即可"，我在这里停下等你点头，再跑这一串（预计 3–5 次 LLM 调用）。

## 二十一、工作区改动的拆分清单

见仓库根目录 `WORKSPACE_CHANGES_SPLIT.md`（**只做整理，未动 index、未提交**）：
它把 174 项改动分成 B 线（另一条功能线：`core/db.py`/`celery_app.py`/`main.py`/`task_executor.py`，
也就是后端 16 条失败测试的来源）、A 线（本次六步流程与生成链路）、前端 generated 产物、其它四组。

### 20.1 小项目已真实跑完「拆分镜 + 提取资产」（真实 LLM，5 次调用）

用户确认后，在临时付费窗口（`:8000` 以 `JELLYFISH_DRY_RUN=0 JELLYFISH_REAL_LLM_CONFIRMED=1` 重启）内**全部通过真实页面**操作：

| 步骤 | 用户在哪点 | 结果 | 落在哪 |
|---|---|---|---|
| 第 1 步 AI 拆分镜 | 项目第 1 步「剧本」→ 章节行主操作「提取分镜」 | toast「分镜提取完成，共 4 个分镜」 | `shots` 新增 **4 条**（标题/剧本摘录都是模型写的，如「林小满推门而入，雨水沿伞尖滴落，望向角落座位」） |
| 第 2 步 AI 提取资产 | 分镜编辑页 →「**2 提取确认**」页签 →「提取并刷新候选」（4 镜各一次） | 3 次拿到 toast「提取完成，候选已刷新」（第 1 镜的 toast 被轮询错过，但候选已落库） | `shot_extracted_candidates` 新增 **13 条**（场景 1 / 角色 1 / 道具 1 / 服装 1 等），另有 1 条对白候选 |

**真实 LLM 调用计数：1（拆分镜）+ 4（逐镜提取）= 5 次**。跑完立即把 `:8000` 重新以**守卫开启**重启（`dry_run=True` 已复核）。

### 20.2 顺带发现的两个真问题（待修）

1. **章节列表的「分镜数」不更新**：`chapters.storyboard_count` 在同步拆分镜之后仍是 **0**，
   而该章节实际已有 4 条镜头 —— 剧本页那一列会让人以为拆分镜没生效。
2. **「提取并刷新候选」藏在「2 提取确认」页签里**：新章节打开分镜编辑页时自动落在「1 基础信息」，
   而"要先提取"的提示文案在隐藏页签内，用户在基础信息页看不到任何提取入口（我这次也是先找了一圈才找到）。

### 20.3 下一步（本轮未完成，下一轮继续）

- 在页面上逐个确认 13 条候选（点「关联 / 新建」会弹新建资产表单，需要连同表单一起走完）→ 4 镜变 `ready`。
- 第 3 步：对本项目资产跑真实大模型图片提示词（1–2 个资产）+ 保存。
- 第 4 步：对 4 镜跑真实大模型视频提示词 + 保存（只补缺失）。
- 绑定（含"本镜无需声音"标记）→ 导出 TXT（出口一）。
- 出口二：真实出图 1 张（采纳 + 设版）与真实出视频 1 条。

### 20.4 第 2 步确认候选时挖出的一个**阻断级真 bug**（本轮已修）

**现象**：在分镜编辑页「2 提取确认」里点「关联 / 新建」后，**业务关联建好了、界面也显示"当前镜头已关联"**，
但 `shot_extracted_candidates.candidate_status` 仍是 `pending`。按项目口径（`site/content/docs/guide/shot-status-flow.md`：
"只要还有任意一条候选 pending，镜头就不能 ready"），**镜头永久卡在 `pending`**；
更糟的是界面认为候选已处理，**不再显示任何操作按钮**，用户无处可点（我自己就卡在这里）。

**根因**：`app/services/studio/shot_preparation_state.py::link_existing_asset_for_preparation`
只调 `upsert_shot_character_link` / `create_project_asset_link` 建业务关联，
**没有回写候选状态** —— 而同文件生态里 `shot_extracted_candidates.mark_linked_by_name()` 早就写好了，
注释还写着"用于真实资产关联动作发生后，将提取候选同步回写为 linked"，只是没人调用。

**修复**：关联成功后按（镜头 + 候选类型 + 实体名）调用 `mark_linked_by_name` 回写 `linked` + `linked_entity_id`；
新增回归测试 `tests/test_audio_opt_out.py::test_preparation_link_marks_matching_candidate_linked`。

### 20.5 主流程里另一个更容易踩的坑：新建资产被甩到新标签页且**预填全丢**

分镜编辑页点「新建」原本是 `window.open('/assets?tab=scene&create=1&name=…&projectId=…')`：
- 资产页会把查询参数抹掉（实测打开的是 `/assets?tab=scene`），**预填的名称/描述/项目/章节/镜头全丢**；
- 用户必须在新标签里**重新手填**一遍，再回到分镜页继续 —— 主流程被硬生生截断。

**修复**：改为**就地新建并关联**（调实体新建接口，带 `project_id/chapter_id/shot_id` 直接落关联），
确认框文案也改成「项目中还没有「X」，是否新建并关联到本镜？」。留在同一页，不再开新标签。

### 20.6 当前测试项目状态（本轮结束）

| 项 | 值 |
|---|---|
| 项目 / 章节 | `bd53bd4d-…` / `1bd1d100-…`（4 镜） |
| 真实 LLM 调用 | 拆分镜 1 + 逐镜提取 4 = **5 次** |
| 候选 | 13 条资产候选（**6 linked / 7 pending**）+ 1 条对白候选 |
| 新建资产 | 林小满（角色）、咖啡店 / 咖啡店 角落座位（场景）等 |
| 4 镜状态 | 仍 `pending`（就是 §20.4 那个 bug 造成的旧状态；修复只对"修复之后的操作"生效，已产生的"关联了却没回写"需要走"取消关联→重新关联"或修数据） |

## 二十二、流程修正（用户 2026-09-19 追加，最高优先级）：视频提示词主入口放到**集级页面**

### 修正后的六步（第 4 步的位置变了）

```
1 剧本：一整集拆成若干镜头
2 提取资产：人物 / 场景 / 道具 / 服装（候选确认）
3 图片准备：大模型生成图片提示词 → 确认保存 → 出图
4 ★集级视频提示词：在**进入分镜工作台之前**的集页面
     ├─ 批量生成（大模型，一次 7~20 条，按镜头顺序）
     └─ 批量导入（巨日禄/外部文本：粘贴或上传文件 → 解析多条 → 自动匹配镜头）
   → 统一**预览 / 校对 / 确认** → 批量保存到各镜
5 分镜工作台：逐镜检查修改 + 图片/声音/参考帧绑定 + 视频生成
6 交付：出口一「下载绑定提示词 TXT」/ 出口二「直接生成视频」
```

**为什么必须这样改**：原来把大模型生成摆在工作室第 4 步，等于要求用户"进工作台后逐镜生成或逐条导入"——
与真实工作方式（一整集的提示词一次生成/一次导入、统一校对后再进工作台）相反；工作台应当只做**逐镜检查与补漏**。

### 四项硬要求（写进验收）

| # | 要求 | 关键细节 |
|---|---|---|
| 1 | 大模型批量生成 | 选当前集全部或部分镜头，**一次生成 7~20 条**；按镜头顺序展示；确认后批量保存；**默认只补没有提示词的镜头** |
| 2 | 外部提示词批量导入 | 一次粘贴文本**或上传文件**；先解析成多条，再自动按**镜头编号或顺序**匹配 |
| 3 | 导入前必须预览 | 保存前显示「**镜头编号 — 镜头内容 — 待导入提示词 — 匹配状态**」；数量不一致 / 编号重复 / 无法匹配 / 镜头缺失都要明确提示，由用户调整后再确认，**不能错位写入** |
| 4 | 覆盖规则三选一 | **只填充空白镜头（默认）** / 覆盖用户选中的镜头 / 跳过已确认的提示词；绝不静默覆盖 |

工作台内保留「单镜生成 / 重新生成」，定位是**补漏与返工**，不是主流程。

### 新的验收口径（7~10 镜小项目，替换原来的 3~5 镜）

`bd53bd4d-…`（4 镜）作为"流程跑通"的样本保留；**再建一个 7~10 镜的测试项目**，分别验证：

1. 一次**批量生成**整集视频提示词；
2. 一次**批量导入**整集外部提示词；
3. **导入数量与镜头数不一致时不会错位保存**（明确提示、拦住）；
4. 确认后进入工作台，**每个镜头都能自动读到对应提示词**；
5. 在工作台**只改某一镜**，不影响其他镜头。

### 状态（本轮结束）

流程修正已写入目标与文档；**实现尚未开始**。当前已具备的可复用件：
`VideoPromptLlmPanel`（工作室内的批量生成面板，可抽出为集级复用）、`saveShotVideoPrompt`（单镜保存）、
`previewVideoPrompt`（真 LLM）、`previewPromptDelivery`（整集镜头清单与来源，用于"只补缺失"判断）。
待做：集级页面（放哪、与第 4 步导航的关系）、批量生成后端（一次多镜、可按顺序返回）、
批量导入解析器（粘贴/上传 → 多条 → 编号/顺序匹配 + 冲突报告）、三选一覆盖策略、预览确认表。

### 22.1 本轮（目标轮 5）后端主干已落地

新增集级看板服务与路由（**这是第 4 步的主干，工作台面板降级为补漏**）：

| 端点 | 作用 | 关键语义 |
|---|---|---|
| `GET /api/v1/studio/prompt-board/{chapter_id}` | 集级看板（只读） | 按集内顺序返回每镜：`code`(S%03d)/标题/剧本摘录/当前 `video_prompt`/来源 + `has_prompt`/`is_confirmed` |
| `POST …/{chapter_id}/generate` | 批量生成**草稿** | 真调大模型；**不落库**；演练或 `meta.llm_called=false` 时标 `dry_run` 且不写 |
| `POST …/{chapter_id}/import-parse` | 批量导入**解析+匹配** | **不落库**；返回逐条「编号/正文/匹配到的镜头/匹配方式/状态」与冲突清单 |
| `POST …/{chapter_id}/save` | 确认后批量保存 | 覆盖模式三选一（默认只补空白）；`allow_partial=false` 默认拦截数量不一致 |

覆盖与安全规则（都写了测试）：

1. **生成不落库**：`generate` 只返回草稿（`draft_count`），`saved_count` 恒为 0；保存必须另调 `save`。
2. **数量不一致默认拦截**：8 镜只导入 3 条，即使 3 条都匹配成功，`save_allowed=false` 且 `save` 直接拒绝；
   只有显式 `allow_partial=true`（前端"仅保存已匹配项"）才允许写入。
3. **重复目标拦截**：同一镜头被指定两次 → 拒绝保存（错位覆盖的典型征兆）。
4. **编号重复/无法匹配**逐条给出状态与原因，任一存在即禁止一键保存。

### 22.2 候选状态 bug 的重新核对（按用户要求）

用户判断正确：**底层本就有回写** —— `upsert_shot_character_link` / `create_project_asset_link` 内部都调
`mark_linked_by_name`。我上轮加在 `link_existing_asset_for_preparation` 上的那层回写属**重复调用，已回退**。
真正的缺口在**就地新建**路径：`entity_crud.create_entity` 里

- character → `upsert_shot_character_link`（内部回写 ✅）；
- **scene / prop / costume → 通用 `upsert_project_link`（纯业务关联，不管候选 ❌）**

于是"新建并关联"之后场景/道具/服装候选仍停在 `pending`，镜头永远 ready 不了。
**修复**：在 `create_entity` 的 link 之后，对这三类补 `mark_linked_by_name`。

**回归测试（改前失败 / 改后通过，同一条路径）**：
`tests/test_prompt_board.py::test_entity_create_with_shot_marks_candidate_linked_for_all_asset_types`
—— 实测：把该修复临时摘掉 → `FAILED`（scene/prop/costume 候选未 linked）；装回 → `PASSED`。

### 22.3 尚未做（下一轮）

- **集级生产页面还没有**（用户点名：只有后端草稿不算主流程改变）。要做：集级入口页面（放在项目工作台第 4 步，
  即进入分镜工作台之前）+ 整集预览表（逐条可改/删/重新生成/取消 + 确认保存）+ 导入预览表
  （镜头编号/镜头内容/导入提示词/匹配方式/匹配状态 + 手动改匹配）+ 三选一覆盖策略 + "仅保存已匹配项"开关。
- 工作台内 `VideoPromptLlmPanel` 降级为单镜补漏（去掉批量入口）。
- 7~10 镜干净项目的页面级验收（旧 4 镜项目不再修 HISTORICAL 状态）。

### 22.4 按用户 2026-09-19 二次修正调整（本轮完成）

| 修正 | 落地 |
|---|---|
| ①批量生成必须"页面可真正停止" | **删掉**多镜 `POST …/generate`（一个请求循环调全部镜头，点停止也拦不住后面的付费调用）；改为**单镜** `POST …/{chapter_id}/draft`：页面维护逐镜队列，一次一镜，停止即不再发下一镜，已完成草稿保留、失败项单独重试，**不新建异步任务系统** |
| ②两个行为相同的选项不能并存 | 覆盖模式**只保留两个**：`fill_empty`（默认）/ `overwrite_selected`；**删掉** `skip_confirmed`。同时 `BoardShot.is_confirmed` 不再靠来源猜，注释明确写"当前没有可靠确认状态"；`internal` / `shot_description` **不再**被当成"用户已确认" |
| ③来源必须由流程决定 | `save` 只接受请求级 `origin`（`llm_draft` / `jurilu_import` / `external_import` / `manual`），由服务端映射成真实 `video_prompt_source`；条目**不再接受**调用方给 `source`。声明 `origin=llm_draft` 的条目**必须带后端签发的草稿令牌** `sha1(镜头|提示词)`，否则拒写 —— 手工粘贴的内容标不成 `llm` |
| 新增来源 | `external_import`（其它外部平台批量导入）加入 `SAVABLE_VIDEO_PROMPT_SOURCES` 与交付导出白名单（两处由同步测试兜住） |

**实测（当前运行中的 `:8000`，DRY_RUN）**：

```
POST /studio/prompt-board/{cid}/draft      {"shot_id":"68598337-…"}
→ {code:"S001", status:"dry_run", reason:"演练模式：后端未真实调用大模型；这是占位草稿，不能保存。"}

POST /studio/prompt-board/{cid}/import-parse {"text":"S001 第一镜提示词"}   # 4 镜只给 1 条
→ save_allowed: False | count_mismatch: True | matched_only_save_allowed: True
  issues: ["数量不一致：解析出 1 条，本集有 4 个镜头…默认阻止整体保存；确需只保存已匹配项请显式切换"]
  entry:  {number:1, matched_by:"number", shot_id:"68598337-…", status:"ok"}
```

测试：`tests/test_prompt_board.py` **12 条**全绿，含
「同路径回归（entity create 回写候选）」「数量不一致默认拦截」「重复目标拦截」
「草稿令牌：手写内容标不成 llm」「来源由流程决定：同文案不同 origin → 不同 source」「缺 origin 直接拒绝」。

## 二十三、第一部分完成：集级视频提示词生产页面（2026-09-19）

### 入口与位置

**项目列表 → 项目 → 顶部第 4 步「视频提示词」**（`/projects/{pid}?step=video_prompt`），
即**进入分镜工作台之前**的集级页面。该步骤以前只显示进度卡 + 「进入工作室」，现在直接渲染
`EpisodeVideoPromptBoard`（新页面），工作台入口仍在右上角。

### 页面能力（都在同一张预览确认表里收口）

| 能力 | 实现 |
|---|---|
| 批量生成草稿 | 选本集全部/部分镜头 → **逐镜队列**：一次只请求一镜（`POST /prompt-board/{cid}/draft`），完成一镜立即显示一镜 |
| 停止 / 重试 | 「停止」= 不再发下一镜，已完成草稿保留；「重试失败项（n）」只重跑失败镜头 |
| 批量导入（主入口） | 「巨日禄 Cookie 导入」抽屉：URL / Cookie / Authorization / auth_mode / Referer → 调既有 `/studio/jurilu-import/{pid}/preview`（**不写库**）→ 结果进同一张表 |
| 批量导入（辅助入口） | 「其他外部平台」：粘贴文本或**上传文件** → `POST /prompt-board/{cid}/import-parse`（**不写库**）→ 同一张表 |
| 预览确认表 | 列：镜头编号 / 镜头内容 / 提示词（可编辑）/ 来源 / 匹配方式 / 匹配状态与原因 / 操作（改镜头·重新生成·删除）；顶部「取消本次操作」清空 |
| 覆盖策略 | 二选一：**只填充空白镜头（默认）** / 覆盖选中镜头 |
| 数量不一致 | 默认**阻止保存**；必须显式勾「仅保存已匹配项」才允许部分保存 |
| 来源处理 | 按流程分组保存：`llm_draft`（须带服务端 HMAC 签名令牌）/ `jurilu_import` / `external_import` / `manual`；同一张表可混合来源 |
| 演练内容 | `dry_run` 草稿在表中标「演练草稿（不可保存）」且勾选框禁用；后端对占位文本逐条拒写 |
| 「已确认数量」 | 页面与接口都**不再显示**（系统当前没有可靠的确认状态） |

### 页面实操证据（演练模式，0 真实付费调用）

脚本 `/tmp/dsh_ui/board_accept.py`（另用 `/tmp/dsh_ui/board_10_stop_midway.png` 证明停止），
日志 `/tmp/dsh_ui/board_accept_log.json`，截图 `board_1_open.png` … `board_11_after_stop.png`：

| 步骤 | 观察到的结果 |
|---|---|
| 打开第 4 步 | `is_board=true`；有「批量生成草稿」「批量导入」；**不含"已确认"字样** |
| 选中本集全部 | 按钮变「批量生成草稿（4 镜）」 |
| 批量生成（演练） | 表格出现 **4 行**「演练草稿（不可保存）」；**数据库查证：4 镜 `video_prompt` 仍为空**（未确认不落库）|
| 停止（用 Playwright 在网络层加 1.2s 延迟制造可中断窗口） | 点击停止时已发 **6** 个 `draft` 请求、表中 5 行；**7 秒后请求数仍是 6**、行数不再增长 → 后续镜头确实没有发出，已完成草稿保留 |
| 批量导入 3 条（本集 4 镜） | 出现「数量与镜头不一致：默认阻止保存」告警；3 行匹配正常 |
| 未勾选直接点保存 | toast：**「数量不一致：默认不允许保存，请先确认『仅保存已匹配项』」**，数据库无变化 |
| 勾选「仅保存已匹配项」后保存 | toast：「已保存 3 条到镜头」；数据库 3 镜写入，`video_prompt_source='external_import'`，第 4 镜仍为空 |
| 保存后回看生成目标 | 模式=只填充空白 → 按钮变「批量生成草稿（**1 镜**）」（已填的 3 镜被跳过，不静默覆盖）|
| 改一条正文再保存 | 该行按流程来源仍记 `external_import`（按你的口径：只有**大模型草稿被改**才改记 `manual`）|
| 巨日禄 Cookie 入口 | 抽屉表单渲染正常（URL/Cookie/Authorization/auth_mode/Referer）；**无真实 Cookie，未宣称抓取成功**，仅验证入口与"结果不落库"的设计 |

数据库对照（同一集 4 镜）：

```
保存前：[('1853f577','',''), ('3fe2321a','',''), ('68598337','',''), ('c2a27c05','','')]
保存后：[('1853f577','周迟把咖啡推过来…','external_import'),
        ('3fe2321a','（人工改过）林小满推门而入…','external_import'),
        ('68598337','林小满推门而入，雨水沿伞尖滴落…','external_import'),
        ('c2a27c05','','')]
```

### 本部分**未**验证 / 未做

- 巨日禄真实抓取未跑（无可用 Cookie）；如需模拟验证，可用固定 mock 响应，但必须标明"模拟"。
- 「重试失败项」未实际触发（演练模式没产生失败项）；按钮与逻辑在页面里，但**没有真实失败样本**。
- 工作台内批量面板**尚未**降级（第二部分再改）；最终 7~10 镜验收项目也按你的要求**未建立**。

## 二十四、第一部分收口：安全与防错（2026-09-19）

### 24.1 预览表作为整体：任何时刻不允许两条被勾选记录指向同一镜头

| 场景 | 行为 |
|---|---|
| 手动更换某行的匹配镜头 | **立即提示冲突并拒绝这次选择**（行保持原状）——`findConflictingRow()` |
| 对导入行点「重新生成」 | **替换当前行**（key 不变）：不新增行，来源变成 `llm_draft` 并带上新草稿令牌 |
| 点「确认保存」前 | **再做一次整表唯一性校验** `validateTableUnique()`，且**发生在按来源分组之前** —— 否则不同来源分两次调用会先后写同一镜头 |

证据（页面实操）：

```
阳性对照：第 2 行改成空闲镜头 S003 → 无冲突提示（成功）
冲突用例：第 2 行改成 S001（第 1 行已占用）
        → toast「镜头 S001 已被另一条记录占用（来源：外部导入），请先删掉那一条再改。」
        → 该行保持原值不变（截图 verify_1_conflict_blocked.png）
重新生成：导入 4 行 → 对某行点「重新生成」→ 行数仍是 4，该行标记变为「演练草稿」= llm_draft
        （截图 verify_2_regenerate_inplace.png）
```

### 24.2 敏感信息收口

| 项 | 落地 |
|---|---|
| 草稿签名密钥泄漏面 | 删除了仓库附近的 `backend/.prompt_draft_secret`；本地开发密钥改放 **`backend/storage/.prompt_draft_secret`**（运行数据目录） |
| 忽略规则 | `.gitignore` 新增 `backend/storage/`、`backend/.prompt_draft_secret`、`.prompt_draft_secret`；`git check-ignore -v` 命中 `backend/storage/`，`git status` 里不再出现密钥与 storage 生成物 |
| 生产口径 | `JELLYFISH_ENV=production/prod/staging` 时**必须**从 `JELLYFISH_PROMPT_DRAFT_SECRET` 读取，缺失直接抛错拒绝服务；只有本地开发才落到被忽略的运行数据目录 |
| 签名算法 | 仍是 **HMAC-SHA256 + `hmac.compare_digest`** 常数时间比较（未退回普通摘要） |
| 巨日禄 Cookie / Authorization | 输入框改为**掩码**（`Input.Password`）；抓取完成、抽屉关闭、点「取消本次操作」、离开页面（组件卸载）**四处都立即清空**；错误提示只透出后端文案，不回显凭证 |

证据（页面实操）：

```
填入 Cookie（36 字符）→ 关闭抽屉 → 重新打开「巨日禄 Cookie 导入」
→ Cookie 输入框 = '' ，Authorization 输入框 = ''        （截图 verify_3a/3b_cookie_*.png）
→ 整页文本中检索 "__SECRET_COOKIE" ：未出现
```

### 24.3 三项页面验证结论

1. **手动把两条内容改到同一镜头 → 阻止保存/选择**：通过（见 24.1 的冲突用例与阳性对照）。
2. **导入行「重新生成」仍只有一行且变成大模型草稿来源**：通过（行数 4→4，标记变「演练草稿」）。
3. **关闭并重开巨日禄抽屉后 Cookie/Authorization 为空 + 密钥不入版本控制**：通过（输入框为空、页面无凭证文本、`git check-ignore` 命中密钥路径）。

**诚实说明**：保存前的整表唯一性校验是"兜底"——由于逐行更换匹配已被拦住，页面上**无法制造**出两组勾选行指向同一镜头的情形，因此这条只能在代码路径上确认（`validateTableUnique` 在分组之前调用），没能在页面上触发到。巨日禄真实抓取仍未验证（无可用 Cookie）。

## 二十五、第二部分：集级确认 → 工作台绑定 → 生成/导出（2026-09-19）

### 25.1 工作台变成「单镜检查 + 补漏」

- 工作室第 6 步新增并**默认落在**「**本镜生产卡**」页签（`ShotProductionCard`）；
- 工作台内的 `VideoPromptLlmPanel` **去掉整集批量入口**，只保留当前镜头的：查看 / 编辑 / 单镜生成草稿 / 重新生成 / 确认保存（面板上标注「单镜补漏」）；整集批量生成与导入的主入口仍是项目工作台**第 4 步**。

### 25.2 生产卡里有什么（一张卡收口）

| 区块 | 内容 |
|---|---|
| 上：提示词 | 已保存的 `video_prompt` + 来源标签；可就地编辑并「保存到本镜（来源：人工修改）」；「还原为已保存内容」；「单镜生成草稿」跳到单镜生成 |
| 中：实际文件 | 每个绑定资产的**真实文件**：缩略图 + `定版 / 非定版 / 无可用文件` + `file_id` + 槽位；声音单列（含「本镜明确标记：无需声音」）|
| 缺什么 | 缺提示词 / 没绑图片 / 有绑定但没有可用图片文件 / 没声音 四类逐条列出；齐全时显示"已具备生成与导出的条件" |
| 下：出口 | 「查看生成请求摘要」（提示词来源、参考图数量、模型/分辨率、时长/画幅、**是否需要关键帧**、提醒）→「直接生成视频」；「导出绑定提示词」（复用既有 TXT 导出端点，按**当前镜头** scope） |

### 25.3 页面验证证据（演练模式，0 付费调用）

测试项目 `bd53bd4d-…`（4 镜）逐镜隔离：

```
依次保存：镜一/镜二/镜三 各自提示词 → 数据库三行分别写入、来源均 manual
切回第 1 镜后再读生产卡 textarea：值 = 镜一的提示词（互不影响）
```

EP01（现有样本，有定版图）第 6 步「本镜生产卡」：

```
卡片文本含：已保存的视频提示词 ✔ ／ 定版 ✔ ／ mig-file-… 实际 file_id ✔ ／ "本镜还缺 1 项"
生成请求摘要：
  提示词来源   llm_orchestration
  参考图数量   1
  模型 / 分辨率 seedance-2.0-mini / 480p
  时长 / 画幅   5s / 16:9
  是否需要关键帧 需要关键帧/首帧
点「直接生成视频」→ 演练模式：shots.generated_video_file_id 前后一致（仍为空）＝ 没有写入正式视频
```

截图：`p2_1_production_card.png`（测试项目生产卡）、`p2_2_per_shot_isolation.png`（逐镜隔离）、
`p2_3_card_ep01.png`（EP01 实际文件与缺项）、`p2_4_plan_summary.png`（请求摘要）。

### 25.4 本部分**未**完成（如实说明，留待你确认后处理）

1. **步骤三态「未开始 / 部分完成 / 已就绪」**：进度条目前仍只显示计数（共 N 镜 / 有正文 X / 已绑定 Y），**没有**换成三态判定。
2. **进入工作台默认定位到第一个未完成镜头**：仍是"保持上次选择/第一个镜头"，未实现。
3. **导出前的缺项交互**：卡上已列出缺项，但「导出绑定提示词」是直接开 TXT，**没有**"列出缺项→由用户选择只导出已就绪 / 返回补齐"这一步弹窗。
4. **TXT 下载的页面端到端截图**：本轮用导出 URL + 早前 curl 校验内容（含镜头编号/提示词/来源/绑定文件），**没有**截"页面点击→下载完成"这一张。

## 二十六、第二部分补完（一）：生产卡区分三类内容 + 缺帧前置拦截（2026-09-19）

### 26.1 后端：计划里如实带出"本次请求实际使用的帧"与音频状态

`VideoSubmitPlanRead` 新增：`required_frame_types` / `frames[]`（role、frame_type、file_id、url、usable）、
`missing_frame_types` / `generation_blocked` / `blocked_reason`、`audio_file_id` / `audio_url` / `audio_opt_out` / `audio_state`。

实测（`:8000`，DRY_RUN）：

```
SHOT_001 + reference_mode=first
  required=['first']  missing=[]  blocked=False
  frames=[('first','mig-file-e910227a0…', usable=True, url=https://ai-shortdrama-assets.oss-…png)]
  audio_state=bound  audio_file_id=b91a9fa2-…

SHOT_003 + reference_mode=first（这一镜没有首帧）
  required=['first']  missing=['first']  blocked=True
  frames=[('first','',usable=False)]
  audio_state=missing
```

- **缺帧不再以 400 抛出**：计划接口把它转成"计划 + 缺项"，页面能在**点生成之前**看到并处理（其它 400/404 仍如实抛出）。
- `submit_video` 也补了同一口径的前置拦截：`generation_blocked` 时直接返回 `rejected_before_submit`，**一个请求都不发**。

### 26.2 前端：生产卡拆成三段，不再把绑定素材说成"视频实际使用的参考图"

| 段 | 内容 |
|---|---|
| ① 上游素材 | 前面资产步骤绑定的图片：缩略图 + `定版/非定版/无可用文件` + `file_id`；文案明确写"这是生成参考帧的**上游素材**，不是请求里真正发出去的文件" |
| ② 本次请求实际使用的参考帧 | `参考模式` 选择器（first/last/key/first_last/first_last_key/text_only）+ 每个帧的 `frame_type`、`file_id`、可用地址与可用性；缺帧时红字列出并给「去补齐关键帧」；**缺帧时「直接生成视频」按钮禁用** |
| ③ 声音 | `已绑定（公网可用）/ 已绑定但地址非公网 / 未绑定 / 本镜明确无需声音` + `audio_file_id` + 公网地址 |

生成与计划**共用同一份参数**：`submitVideo` 传来的 `reference_mode / ratio / seconds / prompt` 全部取自那份计划对象。

页面实测（EP01，演练模式）：

```
SHOT_001：三段齐全；参考帧 = mig-file-e910227a0…（usable）；声音=已绑定（公网可用）b91a9fa2-…；
          生成按钮可用          （截图 p2b_1_card_three_sections.png）
SHOT_003：②段显示「缺少参考模式要求的帧：first」+「去补齐关键帧」；生成按钮 **禁用**
                                （截图 p2b_2_missing_frame_blocked.png）
```

### 26.3 本部分仍未完成（下一轮继续，如实列出）

1. **第 4 步进入工作台默认定位到"当前步骤下第一个未完成镜头"**：未实现。
2. **三态进度「未开始 / 部分完成 / 已就绪」**：进度条仍只是计数，未改成按每镜真实缺项判定。
3. **导出前的缺项选择弹窗**（列出可导出/缺提示词/缺绑定文件 → 「只导出已就绪镜头」或「返回补齐」）：未实现，导出按钮仍是直接打开 TXT。
4. 切换镜头后工作台会自动切走「本镜生产卡」页签（本轮实测发现的小问题，需要把页签选择按镜头保持）。

## 二十七、第二部分补完（二）：就绪判定、镜头定位、导出出口（2026-09-19）

### 27.1 一套判定驱动三个行为

新增 `front/src/pages/aiStudio/chapter/components/shotReadiness.ts`（**唯一判定来源**）：

- `evaluateShotReadiness()` → 每镜返回：`stepState`（未开始/部分完成/已就绪）、`missing[]`（缺什么）、
  `canGenerate`（还要参考帧齐全 + 计划已加载）、`canExport`（有提示词且来源在白名单）；
- `summarizeStepState()` → 顶部三态：**范围内每镜都就绪才显示"已就绪"**，部分就绪 = 部分完成，全未开始 = 未开始；
- **生成就绪与导出就绪分开**：缺帧只挡住该模式的生成，不挡导出；缺绑定文件允许导出但在标注里列出。

### 27.2 生产卡：计划自动预检 + 按钮门禁

- 进入生产卡、切换镜头、切换参考模式都会**自动拉取当前计划**；
- 切换参考模式后**旧计划立即失效**（`plan=null`），按钮随即禁用；
- 「直接生成视频」在 `plan 未加载 / 计划加载中 / 缺帧 / 无已保存提示词` 时**一律禁用**；
- `doGenerate` **再次校验**这份计划：`plan` 为空或缺帧时直接报错返回，**不会带默认参数提交**。

### 27.3 导出出口闭环

新增 `ExportScopeModal`：按**导出条件**（不是生成条件）把范围内镜头分成
`可导出 / 缺提示词 / 缺绑定文件`，用户选「只导出已就绪镜头」或「返回补齐」，
确认后用最终选中的镜头范围调用**既有 TXT 接口**（`prompt-delivery/{pid}/export?shot_ids=…`）。

### 27.4 实测结果（演练模式，0 付费调用）

| 检查 | 结果 |
|---|---|
| 从项目第 4 步点「进入分镜工作台」 | 进入工作室并**自动落到未完成镜头**（`当前分镜：04 · 两人对坐…`，前 3 镜已有提示词）|
| 顶部三态 | 显示「选中范围：**部分完成**」+ `范围 4 镜 · 可生成 n · 可导出 m` |
| 生产卡计划自动加载 | `参考模式：first · 要求帧：first` 与参考帧 `mig-file-…` 直接显示，无需手点 |
| 缺帧镜头 | ②段红字「缺少参考模式要求的帧：first」+「去补齐关键帧」，**生成按钮禁用** |
| 切换参考模式 | 计划自动重新预检（旧计划先失效、按钮先禁用）|

### 27.5 **仍未通过**的两项（本轮实测暴露，需修）

1. **默认页签没有落在「本镜生产卡」**：直接打开 `?studio=deliver` 时活动页签是「视频生成」，
   必须手点一次「本镜生产卡」。原因待查（`inspectorTabKey` 初值与页签归位逻辑）。
2. **切换镜头时页签仍会被改掉**：停留在「本镜生产卡」时按 → 切下一镜，活动页签跳到了「维护设置」。
   即"切换镜头保持用户当前页签"这条**尚未达成**。

因此本轮**没有**完成用户要求的连续证据（自动定位已达成，但页签保持未达成；导出弹窗虽已实现，
尚未跑到"页面点击→TXT 下载→核对内容"这一条）。

## 二十八、第二部分收口：页签、就绪判定与导出下载（2026-09-19）

### 28.1 修掉的三个真问题

1. **页签被"按镜头自动选旧页签"顶掉**：`ChapterStudio.tsx` 里有一个监听 `selectedShot?.id` 的 effect，
   每次切镜头都会 `setInspectorTabKey(getInspectorTabForSelectedShot(shot))`（camera / gen_ref / ops…），
   把用户停在的「本镜生产卡」顶掉。**已删除该行为**；页签只应在**步骤切换且当前页签不属于新步骤**时才归位。
2. **就绪判定喂了假数据**：顶部汇总与"第一个未完成镜头"定位此前传 `requiredFrameTypes=[]`、`planReady=true`，
   把**缺首帧**的镜头误判成可生成。现在新增**集级就绪批量读取**（`GET /studio/prompt-board/{cid}/readiness?reference_mode=`，
   一次查询、不调模型、不触网），一次带出每镜：`has_prompt / video_prompt_source / bound_image_usable / audio_file_id /
   audio_opt_out / required_frame_types / usable_frame_types / missing_frame_types`，交给唯一判定函数。
   实测 EP01：`total 64 / with_prompt 41 / frames_ready 1`（S001 首帧齐；S002–S004 缺 `first`）。
3. **导出下载在 dev 下其实拿不到文件**：导出 URL 之前是相对路径，而 Vite dev server **没有 `/api` 代理**、
   且 `appType: 'spa'`，于是 `/api/...` 被 SPA fallback 吃掉（返回 index.html）——Part-1 那个下载按钮同样受影响。
   现在 `buildDeliveryExportUrl()` 会带上 `OpenAPI.BASE`（前端本来就用它），点下去是**真的文件下载**。

### 28.2 就绪判定口径（同一份数据 → 三个行为）

| 步骤 | 判定 |
|---|---|
| 视频提示词 | 有正文 + 来源在白名单（`canExport`）|
| 关联绑定 | 有实际绑定文件（`hasBoundFiles`）|
| 生成与交付 | **生成**=提示词 + 参考模式必需帧全部可用 + 无阻断项（`canGenerate`）；**导出**单独按有效提示词（`canExport`）|

顶部三态 = 该范围内 `summarizeStepState()`：**每镜都满足该步骤要求才「已就绪」**；部分满足「部分完成」；全未开始「未开始」。

### 28.3 导出弹窗只保留两个动作

`ExportScopeModal`：列出 `可导出（将进入 TXT）/ 缺提示词 / 缺绑定文件(标注)`，
底部只有 **「只导出可导出镜头（n）」** 与 **「返回补齐」**。**下载范围只含可导出镜头**，
不再提供"导出全部"这种会被后端静默跳过的选项；有提示词但缺绑定文件的镜头照常导出并在弹窗与 TXT 中标注。

### 28.4 连续页面证据（演练模式，0 付费调用，一次跑完）

脚本 `/tmp/dsh_ui/p2_final.py` + TXT 校验脚本，日志 `/tmp/dsh_ui/p2_final_log.json`、`p2_txt_check.json`：

| 步 | 观察结果 |
|---|---|
| 1 | 打开 `?studio=deliver` → 默认页签 **本镜生产卡**（截图 `p2f_1_deliver_default.png`）|
| 2 | 自动定位到**未完成镜头**；顶部「选中范围：**部分完成**」；生产卡**自动加载计划**（`参考模式：first`）；缺帧 → 顶部与卡内都判为**不可生成**、按钮禁用（`p2f_2_autoplan_gate.png`）|
| 3 | 按 → 切镜头后**仍停在「本镜生产卡」**（修复前会跳到「维护设置」）|
| 4 | 切换参考模式到 `text_only` → 自动重新预检：缺帧提示消失、按钮**变为可用**（`p2f_3_mode_switch.png`）|
| 5 | 打开导出弹窗：只有两个动作、无"导出全部"；计数 `可导出 29 / 缺提示词 35`（`p2f_4_export_modal.png`）|
| 6 | 点「只导出可导出镜头」→ **真实下载** `script_3cdc1b751a-episode-jurilu-prompt.txt`（107,677 B）|
| 7 | 文件内容核对：**29 个镜头编号**（S001、S037…）、`【巨日禄提示词】`、`【绑定资产】`、`【绑定素材·实际文件】`（含 `[定版]` 与 file_id）均在（`p2_txt_check.json`）|

**第二部分到此闭环。** 仍保持：演练模式、未建最终验收项目、无真实付费调用、未进入第三部分。

## 二十九、导出下载链路修正（第二部分收口，2026-09-19）

### 29.1 之前为什么"看着成功、实际是 404"

- 导出按钮是 `window.open(相对地址)`：前端 dev server **没有 `/api` 代理**且 `appType:'spa'`，
  相对地址被 SPA fallback 接住 → 打开的是**应用自己的 404 页面**，但代码路径把这次跳转当成成功。
- 另外 `Content-Disposition` 在跨域下默认不暴露，浏览器拿不到后端文件名。

### 29.2 现在的实现（真实文件下载 + 失败可见）

新增 `downloadDeliveryTxt()`（`services/llmPipelineApi.ts`）：拼**绝对后端地址**（`OpenAPI.BASE` + 路径）→ `fetch` →
**非 2xx 直接抛错**（页面 `message.error` 提示，绝不打开 404 页面）→ `Blob` + `<a download>` 触发浏览器下载。
生产卡导出弹窗的确认、「本集进度」条的下载按钮都改走它。

### 29.3 严格验收（**同一次页面操作**，演练模式、0 付费）

脚本 `/tmp/dsh_ui/p2_dl.py`，日志 `/tmp/dsh_ui/p2_dl_log.json`：

| 项 | 值 |
|---|---|
| 交互 | 生产卡 →「导出绑定提示词」→ 弹窗两个动作 `返回补齐 / 只导出可导出镜头（29）` → 点后者 |
| **同一次交互捕获到的 download 事件** | 有（Playwright `expect_download`），文件名 `script_3cdc1b751a-prompt.txt` |
| **实际文件路径** | `/tmp/dsh_ui/downloaded_delivery.txt` |
| **字节数** | **107,680**（非空）|
| **本次请求最终地址** | `http://localhost:8000/api/v1/studio/prompt-delivery/script_3cdc1b751a/export?scope=episode&shot_ids=…&chapter_id=script_3cdc1b751a%3A%3AEP01&include_bindings=true`（**指向后端 :8000**，不是前端路由）|
| 文件内容检查 | 镜头编号 **29 个**（S001、S037…）✔ / `【巨日禄提示词】` ✔ / `【绑定资产】` ✔ / `【绑定素材·实际文件】` ✔ / `file_id=` 存在（如 `b91a9fa2-…`、`mig-file-0c9490808d02b161`）✔ |
| 页面反馈 | toast「已下载交付提示词：script_3cdc1b751a-prompt.txt（107680 字节，29 镜）」——**不是 404 页面** |

说明两点，避免误解：
1. `download.url` 是 `blob:`（fetch+Blob 方案下 anchor 的 href 必然是 blob），
   **证明"打到后端"的是同一次交互里实际发出的请求地址**（上表最后一项，`http://localhost:8000/...`）。
2. 文件名暂为前端兜底名（后端 `Content-Disposition` 未跨域暴露），仅影响命名，不影响内容。

## 三十、第三部分（进行中）：8 镜验收项目

### 30.1 已完成（全部通过页面操作，DRY_RUN，0 付费）

| 步 | 页面路径 | 结果 |
|---|---|---|
| 新建项目 | `/projects` →「新建项目」→ 填名称/简介/比例 16:9 →「创建并进入」 | 项目 **`b28a9273-0982-438b-9644-79bea8cc88dd`**「八镜验收项目·完整链路（2026-09-19）」 |
| 新建章节 + 剧本 | 项目第 1 步 →「创建第一章」→ 标题 + 粘贴 8 段短剧剧本 | 章节 **`b6e2d639-9395-44f3-999b-b92dccda9c30`**「第一集 雨夜咖啡店」（原文 297 字）|

只读核对（不写库）：`projects` 一行、`chapters` 一行，与页面一致。

### 30.2 后续步骤的**页面能力盘点**（决定这条链路能否在 DRY_RUN 里跑完）

| 需要的页面能力 | 现状 |
|---|---|
| 手工创建镜头（8 镜，不依赖 LLM 拆分镜） | ✅ 已有：分镜列表页「创建分镜」（`POST /studio/shots`，自动取下一个 index） |
| 手工创建并关联资产（人物/场景/道具/服装） | ✅ 已有：资产库/角色页新建 + 工作室第 5 步「关联绑定」链接 |
| 图片提示词（不走 LLM） | ✅ 已有：第 3 步「填提示词」手工保存到 `image_prompts`（来源如实标 `saved`，不冒充 LLM） |
| 资产图片与定版图 | ✅ 已有：资产编辑页上传图片 + 「设为定版」 |
| 镜头参考帧 | ⚠️ 需在「关键帧与参考图」里用**已上传图片**填充槽位（本项待实操确认入口是否顺畅） |
| 视频提示词（两条来源） | ✅ 已有：第 4 步批量生成（LLM，DRY_RUN 下只出演练草稿）+「其他外部平台导入」（`external_import`） |
| 声音 / 无需声音 | ✅ 已有：声音绑定区 +「本镜无需声音」 |
| 导出 TXT / 演练门禁 | ✅ 已通过（§28、§29） |

### 30.3 未完成 / 受限于环境

- **8 个镜头本身**、资产新建与关联、图片提示词、图片/定版图、参考帧、8 条视频提示词（两条来源）、逐镜绑定与两个出口的**连续页面操作尚未执行**（本轮只完成了项目与章节）。
- **巨日禄 Cookie 批量导入**：本环境**没有可用测试 Cookie** → 真实抓取**未验证**，不能写成"抓取成功"；可用「其他外部平台导入」保存 8 条测试提示词，来源如实记为 `external_import`。
- **真实出图（关键帧）与真实出视频**：需要付费批准；本轮以"上传测试图片 + DRY_RUN 门禁"代替，不产生真实生成物。
- 工程收尾（前端 build、后端全量测试基线、迁移/回滚脚本核对、敏感信息与生成物检查、文件清单与提交分组建议）**尚未执行**。

### 30.4 本轮进展（页面操作，DRY_RUN，0 付费）

| 步 | 页面路径 | 结果 |
|---|---|---|
| 手工创建 8 个镜头 | `/projects/b28a9273…/chapters/b6e2d639…/shots` →「创建分镜」×8（标题 + 剧本摘录） | **8 条镜头**，只读核对 `shots` 表：index 1–8、标题分别为 雨夜咖啡店·林小满进门 / 特写·旧录音笔 / 周迟递咖啡 / 对坐·眼眶发红 / 录音笔按下 / 窗外雨声 / 周迟起身 / 门口回望 |

截图 `p3_2_shots.png`，日志 `p3_shots_log.json`（`created=8`，无页面错误）。

### 30.5 仍未完成（**不虚报**，当时快照）

> 本节记录的是 §30 落笔那一刻的状态；上面这些项目**已在第三十一节全部跑完**（含一次授权真实出视频）。
> 保留原文是为了让"当时的缺口"和"后来补上了什么"可对账。

- 资产新建与关联、图片提示词、上传测试图与定版、参考帧、8 条 `external_import` 视频提示词、
  逐镜绑定与声音状态、两个出口的连续页面操作、8 镜验收表、TXT 文件检查与数据库只读对照 —— **尚未执行**。
- 用户授权的**一次真实视频生成**（seedance-2.0-mini / 480p / 5s / 16:9）**未执行**：
  前置的"该镜已保存提示词 + 公网可用首帧"尚未准备好，且本轮上下文预算不足以完成后续校验与守卫开关操作，
  因此**没有发起任何付费请求、没有产生任何 credits**。
- 巨日禄 Cookie：**缺少凭证，真实抓取未验证**（本轮未用 `external_import` 冒充）。
- 工程收尾（前端 build、全量测试基线、迁移/回滚核对、敏感信息与生成物检查、文件清单与提交分组）未执行。

## 三十一、第三部分完成：8 镜全链路验收（2026-09-19，页面连续操作）

项目 `b28a9273-0982-438b-9644-79bea8cc88dd`「八镜验收项目·完整链路（2026-09-19）」，
章节 `b6e2d639-9395-44f3-999b-b92dccda9c30`「第一集 雨夜咖啡店」（原文 297 字）。
**全程 DRY_RUN，除 §31.6 那一次获授权的真实出视频外，0 付费调用。**

### 31.1 逐步骤做了什么（全部走页面）

| 步 | 页面路径 | 结果（页面回执） |
|---|---|---|
| 演员新建 | 第 2 步 → 演员 →「新建」×2 | `演员·苏晴（林小满扮演者）`、`演员·陈默（周迟扮演者）`；**创建即自动建项目关联** |
| 角色新建 | 第 2 步 → 角色 →「新建角色」×2（关联演员必填） | `林小满`(actor=苏晴)、`周迟`(actor=陈默)，`characters.project_id` = 本项目 |
| 场景/道具/服装 | 第 2 步 → 场景/道具/服装 →「新建」 | `场景·雨夜咖啡店（内景）`、`道具·旧录音笔`、`服装·林小满米色风衣`，并各自建立**项目级关联行** |
| 老镜头清理 + 重建 | 分镜列表页 → 全选 →「批量删除」（确认按钮文案 `删 除`）→「创建分镜」×8 | 16 条旧镜头（无细节行）删除；新建 8 条，**index 1–8**，每条都带上了 `shot_details`（见 §31.7 修复 1） |
| 图片提示词 | 第 3 步 → 资产行「填提示词」→ 保存到资产 | 林小满 / 周迟 / 场景 / 服装 各 1 条（`image_prompts`）；道具**无槽位**，页面如实显示"不支持（无槽位）" |
| 上传测试图 + 定版 | 资产编辑页「多镜头图片」→ **「上传」**（本轮新增入口，见 §31.7 修复 2）→「设为定版」 | 4 个资产 FRONT 槽位写入本地测试图并 `is_primary=1` |
| 镜头参考帧 | 工作室「关键帧与参考图」→ 首帧卡「上传」×8（同一新增入口） | 8 镜各 1 张 `first`；另给 S001 补了 1 张 `last`（用于缺帧门禁验证） |
| 视频提示词导入 | 第 4 步集级看板 →「批量导入」→「其他外部平台（粘贴/上传）」→ 解析 → 关抽屉 →「确认保存（8 条）」 | 8 条全部「匹配正常 / number」，保存后 8 镜 `video_prompt_source='external_import'` |
| 逐镜核对 | 工作室「视频提示词」页签逐镜翻 | 8 镜均显示「该镜头已保存视频提示词」「来源：external_import」，textarea 值与库里一致 |
| 关联绑定 | 工作室「关键帧与参考图」→ 首帧卡「更多」→ 关联角色/场景/道具（选择即保存） | 场景 8/8、角色 10 条链接（S006 空镜只有场景）、道具 S002/S005 |
| 声音 | 工作室「关联绑定」步骤 → 资产绑定页签 | S001 上传 `test_voice.wav` 并绑定；S002–S008 明确标记「本镜无需声音」（`audio_opt_out=1`） |
| 缺帧门禁 | 本镜生产卡（S001） | 切 `first_last` → 红字「缺少参考模式要求的帧：last」+ **生成按钮禁用**；补尾帧后槽位补齐。**注意**：当时页面把"有 file_id"当可用，所以 `first` 显示可用 —— 这一判定错误已在 §31.10 修正；修正后 `first`/`first_last` 在当前 local 存储下都是**供应商不可用**（按钮禁用），只有 `text_only` 可生成 |
| 演练门禁 | 本镜生产卡 →「直接生成视频」 | toast「演练模式：只展示计划，不会产生正式视频，也未写入任何库」；`status=dry_run`、`provider_task_id=""`、`guard_status="DRY_RUN=开（JELLYFISH_DRY_RUN，未发起真实调用）"` |
| 导出出口 | 本镜生产卡 →「导出绑定提示词」→ 弹窗（只有两个动作）→「只导出可导出镜头（8）」 | **真实文件下载** `b28a9273-…-prompt.txt`（4,915 B），见 §31.4 |

### 31.2 8 镜验收表（页面判定 + 数据库只读对照，两处一致）

断言口径：`frames` 列为 `shot_frame_images`；绑定资产一列为**定版图** file_id 前 8 位；
「可导出」取自导出弹窗逐行判定；「可生成」分两种参考模式 —— **口径修正见 §31.10**：
本机存储是 local，帧文件只能解析成本机 data URL，供应商（APIMart）只接受 http(s):// / asset://，
所以 `first` 模式下 8 镜**都不是供应商可生成**；`text_only` 不需要参考帧，8 镜可生成。

| 镜 | 标题 | 提示词来源 | 字数 | 绑定资产（定版图 file_id） | 参考帧槽位 | 声音 | 可生成 `text_only` | 可生成 `first` | 可导出 |
|---|---|---|---|---|---|---|---|---|---|
| S001 | 雨夜咖啡店·林小满进门 | external_import | 59 | 角色 林小满[定版] `8a76b641`；场景 咖啡店[定版] `54132b49` | first `9365da78` + last `b0121527`（均已上传，**供应商不可访问**） | 已绑定 `1ebace78`（本地地址，不随请求发出） | ✅ | ❌ 帧不可访问 | ✅ |
| S002 | 特写·旧录音笔 | external_import | 40 | 林小满；场景；道具 旧录音笔[定版] `4f142efc` | first `ade1feb3`（同上） | 本镜无需声音 | ✅ | ❌ 帧不可访问 | ✅ |
| S003 | 周迟递咖啡 | external_import | 40 | 林小满；周迟[定版] `43136a52`；场景 | first `217a0e52`（同上） | 本镜无需声音 | ✅ | ❌ 帧不可访问 | ✅ |
| S004 | 对坐·眼眶发红 | external_import | 42 | 林小满；周迟；场景 | first `31b0bed6`（同上） | 本镜无需声音 | ✅ | ❌ 帧不可访问 | ✅ |
| S005 | 录音笔按下 | external_import | 42 | 林小满；场景；道具 旧录音笔 | first `4fd40383`（同上） | 本镜无需声音 | ✅ | ❌ 帧不可访问 | ✅ |
| S006 | 窗外雨声（空镜） | external_import | 43 | 场景 `54132b49`（无角色，符合空镜） | first `376db4de`（同上） | 本镜无需声音 | ✅ | ❌ 帧不可访问 | ✅ |
| S007 | 周迟起身 | external_import | 37 | 林小满；周迟；场景 | first `b5d49237`（同上） | 本镜无需声音 | ✅ | ❌ 帧不可访问 | ✅ |
| S008 | 门口回望 | external_import | 45 | 林小满；场景 | first `0ed7abd5`（同上） | 本镜无需声音 | ✅ | ❌ 帧不可访问 | ✅ |

**修正后的就绪接口对照（只读 GET，判定修复后实测）**：

```
reference_mode=first     → summary: {"total": 8, "with_prompt": 8, "frames_ready": 0,
                                     "frames_missing": 0, "frames_unusable": 8}
                          每镜：usable_frame_types=[] / missing_frame_types=[] /
                                unusable_frame_types=["first"] / generation_blocked=true
                          原因（后端原样给出）：「帧已存在，但供应商无法访问：该文件是本机/相对地址
                          （storage_key=files/frame_sN.png），只能解析成本机 data URL；
                          APIMart 只接受 http(s):// 或 asset://。」
reference_mode=text_only → required_frame_types=[] / generation_blocked=false

（判定修复前这里曾是 frames_ready: 8 —— 那正是被修掉的错误结论，见 §31.10）
```

### 31.3 连续页面证据（可重跑脚本 + 截图 + 日志）

从**项目列表**一路点到**两个出口**，本轮全部改成"只用鼠标点"（见 §31.7 修复 3）：

| 脚本（`/tmp/dsh_ui/p3/`） | 证明什么 |
|---|---|
| `m1_step4_board.py` | 列表搜到项目 → 点进工作台 → 点顶部「4. 视频提示词」→ **集级看板**（`本集 8 镜`）→ 右上角进工作室 |
| `a1_actors.py` / `a3b_roles.py` / `a2_assets.py` | 演员 / 角色 / 场景·道具·服装的新建与项目关联 |
| `b1_upload.py` / `b2_prompts.py` / `b3_prompts2.py` | 上传测试图 + 设为定版；第 3 步逐资产保存图片提示词 |
| `c4_clean_recreate.py` / `c5_create8.py` | 清空旧镜头并用页面重建 8 镜（保留删除前后的行数） |
| `c6_frames2.py` | 8 镜首帧逐镜上传（每次都打印 `file_id`） |
| `d1_import.py` / `d3_import_save.py` | 外部导入解析（8 行「匹配正常」）→ 确认保存 8 条 |
| `e2_bind.py` / `e4_bind_roles.py` / `f1_audio.py` | 逐镜资产关联；S001 绑定音频、其余标记无需声音 |
| `g1_verify_prompts.py` | 工作台逐镜提示词与来源核对 |
| `g2_gate.py` / `g4_gate_after2.py` | 缺帧门禁（`first_last` 缺 `last` → 生成禁用）与补齐后恢复 |
| `h2_dryrun_export.py` / `h3_dryrun_probe.py` | 演练生成门禁回执；导出弹窗两个动作 + 真实下载 + TXT 内容 |
| `j1_real_try_first.py` | 真实出视频（`first` 失败 → `text_only` 成功，见 §31.6） |
| `k1_playback.py` / `k2_playback_chrome.py` | 生成结果在页面里重新读取与播放 |

截图：`m1_1_list.png` → `m1_2_project.png` → `m1_3_board.png` → `m1_4_studio.png`（连续四张）、
`g2_2_first_last_missing.png`（缺帧红字 + 按钮禁用）、`g4_after_fill.png`（补齐后恢复）、
`h2_dryrun_gen.png`（演练门禁）、`h2_export_modal.png` / `h2_after_export.png`（导出出口）、
`k2_playback_chrome.png`（成片播放，见 §31.6）。

### 31.4 TXT 实际文件与内容检查（出口一）

| 项 | 值 |
|---|---|
| 交互 | 生产卡 →「导出绑定提示词」→ 弹窗只有 `返回补齐 / 只导出可导出镜头（8）` |
| 同一次交互捕获的 download | 有（Playwright `expect_download`），文件名 `b28a9273-0982-438b-9644-79bea8cc88dd-prompt.txt` |
| 落盘路径 / 字节 | `/tmp/dsh_ui/p3/downloaded_delivery_8shots.txt` / **4,915 B**（2,671 字符） |
| 本次请求最终地址 | `http://localhost:8000/api/v1/studio/prompt-delivery/b28a9273-…/export?scope=episode&shot_ids=…（8 个）&chapter_id=b6e2d639…&include_bindings=true`（**打后端 :8000**，不是前端路由） |
| 页面反馈 | toast「已下载交付提示词：b28a9273-…-prompt.txt（4915 字节，8 镜）」 |
| 内容检查 | `S001`–`S008` **8 个编号全在** ✔；`【巨日禄提示词】` ✔；`【绑定资产】` ✔；`【绑定素材·实际文件】` ✔；`[定版]` + `file_id=` ✔；`声音：本镜明确标记：无需声音`（7 处）✔；S001 带 `声音：test_voice[shot_detail.audio_file_id] file_id=1ebace78…` ✔ |
| 敏感信息 | 文件内 `cookie / authorization / api key / bearer / sk-` 命中 **0** |

### 31.5 数据库只读对照（不写库，仅核对）

```
projects 1 行：b28a9273…  名称/比例 16:9 ✔
chapters 1 行：b6e2d639…  标题「第一集 雨夜咖啡店」原文 297 字 ✔
shots     8 行：index 1–8（新 id）✔   shot_details 8 行（1:1）✔
shot_frame_images：first ×8 + last ×1 ✔（shot_detail_id 与镜头一一对应）
shot_character_links：林小满×6 镜、周迟×3 镜＝10 行 ✔
project_scene_links：8 镜各 1 行＝8 行（同一场景）✔
project_prop_links：S002/S005＝2 行 ✔
shot_details.video_prompt_source：8 行全为 external_import ✔
shot_details.audio_file_id / audio_opt_out：S001 有值，其余 7 镜 opt_out=1 ✔
shot.generated_video_file_id：S001 = e972ea06-…（真实产物）✔
files：e972ea06-… type=video，storage_key = APIMart 视频地址 ✔
```

对照方式：`sqlite3` 以 `file:jellyfish.db?mode=ro` 只读连接 + 独立 cursor（WAL 下同连接混读会读到旧快照，
本轮已避开）；所有业务写入都发生在页面/接口路径，没有一条是脚本直写。

### 31.6 单次真实 Seedance 视频结果（用户授权，2026-09-19）

付费窗口做法与 §五·补一致：临时把 `:8000` 以 `JELLYFISH_DRY_RUN=0 JELLYFISH_REAL_LLM_CONFIRMED=1` 重启，
跑完**立刻**以默认（守闸）参数重启并按 `/studio/image-pipeline/status` 复核 `dry_run=true`。

| 项 | 值 |
|---|---|
| 目标镜头 | S001「雨夜咖啡店·林小满进门」（`9462ff77…`） |
| 尝试 1（`first`，优先有公网首帧） | **本地即被拒**：`APIMart 的图片入参只接受 http(s):// 或 asset:// 公网地址，不接受 base64 data URL`；响应 `status=failed`、`provider_task_id=""`、`elapsed_ms=0` → **没有发给上游、没有产生任务号、没有费用** |
| 为什么走不成 `first` | 本机存储驱动是 **local**（`backend/` 下没有 `.env`，未配置 S3/OSS），页面上传的图片 `storage_key = files/xxx.png`；`file_id_to_image_ref` 对非公网 key 只能转 data URL，被 APIMart 挡下。**没有公网可用首帧 = 如实记录，不伪造** |
| 尝试 2（`text_only`）—— 唯一一次真实提交 | `status=completed` |
| provider 任务号 | **`task_01M2WDMRS5PTA9YPAYVPKNCPJN`** |
| 耗时 | **167,988 ms**（约 168 s） |
| 生成 URL | `https://getapib.org/video/9998210192129048-…-video_task_01M2WDMRS5PTA9YPAYVPKNCPJN.mp4` |
| 参数 | `seedance-2.0-mini` / 480p / **5s** / 16:9 / `reference_mode=text_only`（0 参考图） |
| 落库 | 页面自动 `files/external` 登记 → `file_id=e972ea06-d871-4eb1-b7a8-0c5dcf7e233f`，并写到 `shots.generated_video_file_id` |
| 产物核验 | HTTP 200 / **1,699,819 B** / `video/mp4`；容器 `isom/iso2/avc1/mp41`（H.264） |
| 页面回读 + 播放 | 工作室「视频生成」页读出该镜成片，`<video src="…/studio/files/e972ea06…/download">`（307 跳上游）；用**系统 Chrome** 播放：`currentTime=5.09s / duration=5.09s / readyState=4 / videoWidth=864 × videoHeight=496 / error=null`（截图 `k2_playback_chrome.png`）|
| 声音 | 本镜绑定的 `test_voice.wav` 是本地地址，后端如实告警"本次不会携带它"→ 请求里**没有**参考音频（不是悄悄带上） |
| 真实调用计数 | **1 次**（`first` 那次在本地被拒，未出网）；上游返回任务号后**没有**任何重复提交 |
| 守卫恢复 | 跑完立即重启并复核：`{"dry_run": true, "real_call_confirmed": false, ...}` |

说明（避免误读）：Playwright 自带 Chromium **没有 H.264 解码器**，同一个页面元素在它会报 `MEDIA_ERR_SRC_NOT_SUPPORTED(error=4)`；
换成系统 Chrome 即正常播放 —— 是浏览器编解码能力差异，不是产物或页面 bug（两次结果都留了截图）。

### 31.7 本轮修掉的 7 个"注定走不下去"的真问题（+1 个测试替身）

1. **手工建的镜头没有 `shot_details`，整条下游链路全断**（后端）
   现象：页面「创建分镜」只写 `shots`，不写 1:1 的 `shot_details`；于是保存提示词 PATCH 404、
   音频绑定/参考帧创建 400、就绪判定读不到东西，而页面上只表现成"点了没反应"。
   修：`studio/shots.create` 现在同时写入默认细节行（取值与「AI 拆分镜」一致，抽成
   `shot_details.build_default_detail`）。`POST /studio/shot-details` 仍是唯一别的入口。
   本轮 8 镜就是删掉重建后带上了细节行的（§31.1 第 4 行）。
2. **资产图片只能"AI 生成→采纳"，没有上传入口**（前端）
   现象：第 3 步要求"上传测试图片并设为定版"，但资产编辑页只有 生成 / 编辑 / 设为定版 三个按钮，
   手头已有的图**无法**填进槽位（不花钱就永远补不上图）。
   修：`AssetEditPageBase` 每个角度卡新增「上传」（`POST /studio/files/upload` → 写槽位 `file_id`）；
   上传与「设为定版」仍是两个独立动作，不隐式改定版。
3. **参考帧只有"AI 生成"一条路，缺帧门禁补不上**（前端）
   现象：`shot_frame_images` 只能由生成流程创建，缺 `first/last` 时除花钱生成外别无办法。
   修：`ChapterStudio` 关键帧卡新增「上传」（已有槽位 PATCH、无槽位先 POST 建槽）。
4. **角色下拉在"全局角色 > 20"时恒为空**（前端）
   现象：`loadProjectRoleOptions` 只取实体列表第 1 页 20 条再按 `project_id` 过滤（接口不支持按项目过滤），
   本项目角色不在前 20 条里 → 「关联角色」下拉永远"暂无数据"，关联角色这步等于做不了。
   修：分页拉取（每次 100 条、最多 5 页）直到不足一页，与工作台 `useProjectStepSignals` 口径一致。
5. **项目列表只取前 10 个、没有翻页，新建的项目在列表里点不到**（前端）
   现象：`ProjectLobby` 写死 `pageSize: 10`，且搜索是本地过滤；本项目排第 12 → 列表里根本看不到
   （"从项目列表到两个出口"的第一步就断了）。
   修：一次拉 100 条（本地筛选/排序逻辑不变）。
6. **第 4 步点进去会跳过集级看板**（前端）
   现象：顶部步骤条对第 4 步直接 `openChapterStudio('video_prompt')`，把 §22 定为"主入口"的
   `EpisodeVideoPromptBoard`（批量生成/批量导入）整个跳过，页面上点不到批量导入。
   修：`handleSelectStep` / `handleContinue` 对 `video_prompt` 改为在工作台内就地渲染看板；
   看板右上角「进入分镜工作台」仍然可去逐镜检查。
7. **生产卡的"生成请求摘要"与真实提交不同参**（前端）
   现象：摘要 `previewVideoSubmitPlan` 不传 `prompt`，后端于是模板拼装（`llm_orchestration`），
   而 `doGenerate()` 提交的是**已保存提示词**；且 effect 依赖里没有 `savedPrompt`，镜头详情异步到手后摘要不刷新
   → 用户核对的对象根本不是要发出去的那份。
   修：两处预览都带 `prompt: savedPrompt`，并把 `savedPrompt` 加进依赖（现在摘要显示 `来源：request` + 导入的正文）。

另：`tests/test_studio_api_responses.py` 的最小 DB 替身补上 `ShotDetail`（否则问题 1 的修复会让该用例报
`Unsupported object type`，属替身能力不足，不是产品缺陷）。

### 31.8 工程收尾（与既有失败基线对比）

| 项 | 结果 |
|---|---|
| 前端 `npm run typecheck` | 通过（本轮改动后重跑） |
| 前端 `npm run build` | 通过（`✓ built in 18.27s`，仅既有 chunk 体积提示） |
| 后端 `pytest -q` | **566 passed / 16 failed**；基线 §14 为 546 passed / 16 failed → **失败集合一致**（`meta: None` 信封类 + `task_executor.reset_db_runtime` 类，均属另一条未提交功能线）。**判定修复后重跑：577 passed / 16 failed**（新增 11 条参考帧判定用例，失败集合不变，见 §31.10） |
| 后端改动模块 `pylint` | `app/services/studio/shots.py`、`shot_details.py`、`tests/test_studio_api_responses.py` → **10.00/10**；判定修复涉及模块 `app/utils/files.py`、`video_submit.py`、`prompt_board.py`、`generated_video.py`、`schemas/studio/image_pipeline.py`、`tests/test_vendor_frame_usability.py` → **10.00/10** |
| 迁移 / 回滚 | `scripts/migrate_llm_pipeline_columns.py --check` → 「✓ 全部 9 列都已存在，无需迁移」；本轮**未新增任何列/表**（只是新建镜头时多写一行 `shot_details`）→ 不需要新迁移，也无需回滚脚本改动 |
| 敏感信息 | 本轮未输入过任何 Cookie / Authorization / API Key；`/tmp/dsh_ui/p3` 全量扫描只有两处**文字**命中（UI 文案「巨日禄 Cookie 导入」、预览响应里的布尔 `api_key_configured:true`），**无凭据值**；TXT 与截图内无密钥 |
| 生成物 | 仓库内**没有**新增媒体产物：`backend/storage/`（含 `generated-videos/`）与 `front/dist/` 均被 `.gitignore` 命中；真实视频的本地副本只落在 `/tmp/dsh_ui/p3/`（未入库）；`backend/jellyfish.db*`、`*.backup_*` 仍是既有未跟踪文件，本轮**未暂存、未提交** |
| 巨日禄 Cookie | **依然缺少可用凭证 → 真实抓取仍未验证**；本轮 8 条提示词来源如实记为 `external_import`，**没有**写成"巨日禄导入成功" |

### 31.9 本轮改动文件与建议提交分组

本轮**只**改这些文件（都在本工作线范围内，未碰其他功能线）：

| 文件 | 改了什么 |
|---|---|
| `backend/app/services/studio/shots.py` | 创建镜头时同写默认 `shot_details`（§31.7-1） |
| `backend/app/services/studio/shot_details.py` | 新增 `build_default_detail()`（该文件另含本工作线早前的产物护栏/声音互斥改动） |
| `backend/tests/test_studio_api_responses.py` | 替身补 `ShotDetail`（§31.7 末） |
| `front/src/pages/aiStudio/assets/components/AssetEditPageBase.tsx` | 资产图片「上传」入口（§31.7-2） |
| `front/src/pages/aiStudio/chapter/ChapterStudio.tsx` | 参考帧「上传」入口 + 角色下拉分页修复（§31.7-3/4） |
| `front/src/pages/aiStudio/chapter/components/ShotProductionCard.tsx`（未跟踪新文件） | 摘要与提交同参（§31.7-7）+ 参考帧供应商口径提示与按钮兜底（§31.10） |
| `front/src/pages/aiStudio/project/ProjectLobby.tsx` | 列表取 100 条，项目不再"点不到"（§31.7-5） |
| `front/src/pages/aiStudio/project/ProjectWorkbench/index.tsx` | 第 4 步回到集级看板（§31.7-6） |
| `backend/app/utils/files.py` | **`resolve_vendor_image_ref` 唯一判定 + `file_id_to_image_ref` 复用同一实现**（§31.10） |
| `backend/app/services/studio/image_pipeline/video_submit.py` | 计划预检返回 `unusable_frame_types`，`generation_blocked` 含"帧不可访问"（§31.10） |
| `backend/app/services/studio/prompt_board.py` | 集级就绪按供应商口径给 `usable/unusable_frame_types`（§31.10） |
| `backend/app/services/film/generated_video.py` | 提交前第二层兜底 `_assert_frames_vendor_acceptable`（§31.10） |
| `backend/app/schemas/studio/image_pipeline.py` | 计划 schema 增加 `ref_kind` / `reason` / `unusable_frame_types` |
| `backend/tests/test_vendor_frame_usability.py`（新增） | 11 条回归测试（§31.10） |
| `front/src/services/llmPipelineApi.ts`、`front/src/pages/aiStudio/chapter/components/shotReadiness.ts` | 前端类型与唯一判定函数区分"缺帧 / 帧不可访问"（§31.10） |
| `SIX_STEP_ACCEPTANCE.md`（未跟踪新文件） | 本节 |

**建议提交分组**（不自动提交；工作区里混着另一条功能线，请人工挑 hunk）：

1. `fix(studio): 手工建镜同时写入 shot_details`：`shots.py` + `shot_details.py` 的 `build_default_detail` 那一段 + 测试替身。
   ⚠️ `shot_details.py` 里还混着早前的护栏/声音互斥 hunk，`shots.py` 里也混着早前的改动 —— **同一文件多线混杂，需按 hunk 拆**。
2. `feat(studio): 资产图片与参考帧支持上传`：`AssetEditPageBase.tsx`、`ChapterStudio.tsx` 的上传 hunk。
   ⚠️ 这两个文件同时承载第一/第二部分的大量改动，同样需按 hunk 挑。
3. `fix(studio): 角色下拉分页 / 项目列表取全 / 第 4 步回到集级看板 / 摘要与提交同参`：
   `ChapterStudio.tsx`（角色下拉）、`ProjectLobby.tsx`、`ProjectWorkbench/index.tsx`、`ShotProductionCard.tsx`。
4. `fix(video): 参考帧可用性按供应商口径判定（计划/就绪/提交同一份实现）`：
   `app/utils/files.py`、`video_submit.py`、`prompt_board.py`、`generated_video.py`、`schemas/studio/image_pipeline.py`、
   `tests/test_vendor_frame_usability.py`、`front/src/services/llmPipelineApi.ts`、`shotReadiness.ts`、`ShotProductionCard.tsx`（帧提示 hunk）。
   `generated_video.py` 里顺带删掉一个未使用的局部变量赋值（只为 pylint，行为不变）。
5. `docs: 第三部分 8 镜验收`（`SIX_STEP_ACCEPTANCE.md`）。

### 31.10 判定修复（用户 2026-09-19 指出）：参考帧可用性按**供应商口径**，不再是"有 file_id 就算可用"

**问题**（真实提交暴露）：`shot_frame_images` 有 `file_id` 只代表"已上传/已绑定"。本机存储驱动是 local 时，
帧文件只能被解析成 base64 data URL，而 APIMart 只接受 `http(s)://` / `asset://`。
旧实现里：
`describe_plan_frames` 对"有 file_id"一律写 `usable=True`（`video_submit.py`）、
`load_readiness` 用 `shot_frames.get(frame)` 当可用帧（`prompt_board.py`）——
于是页面显示"8 镜 first 可生成"并放开按钮，真实点下去才被供应商 400（§31.6 尝试 1 的原始报错）。

**修法：一套判定，三个使用方共用**（不再各写一份）。

| 层 | 位置 | 行为 |
|---|---|---|
| 唯一实现 | `app/utils/files.py:resolve_vendor_image_ref()` | 返回 `kind`（public / local_data_url / missing / not_found / unreadable）+ `vendor_usable` + `reason`；供应商能力表 `apimart=False`、`openai/volcengine=True`、未知一律 False（收敛） |
| 复用 | `file_id_to_image_ref()` | 改为调用同一个实现（data URL 转换也只留一份 `_read_image_as_data_url`），行为对既有调用方不变 |
| 计划预检 | `video_submit.describe_plan_frames()` | 每帧带 `usable`（供应商口径）、`ref_kind`、`reason`；返回 `missing` 与 `unusable` 两类 |
| 计划结论 | `VideoSubmitPlanRead` | 新增 `unusable_frame_types`；`generation_blocked` = 缺帧 ∪ 帧不可用（非 text_only），`blocked_reason` 说清是哪一类 |
| 集级就绪 | `prompt_board.load_readiness()` | `usable_frame_types` 只含供应商可用帧；新增 `unusable_frame_types` / `frame_block_reasons` / `generation_blocked`；summary 增加 `frames_missing` / `frames_unusable` |
| 提交端兜底 | `film/generated_video.py:_assert_frames_vendor_acceptable()` | 真正发请求前再按同一份判定拦一次（不接受的引用绝不出网）；APIMart 适配器自己的 data URL 拒绝保持不动（最外层） |
| 页面按钮 | `ShotProductionCard.tsx` | 帧行显示「帧已存在，但供应商无法访问」+ 具体原因；按钮禁用 = `generation_blocked` **或** `frames[].usable===false`（防计划是旧数据）；点击前再自检一次 |
| 页面就绪文案 | `shotReadiness.ts` | 「缺少参考帧：x」与「参考帧已上传但供应商无法访问：x」分开提示（不再混为一谈） |

**回归测试**（新增 `backend/tests/test_vendor_frame_usability.py`，11 条全绿）：

| 用例 | 断言 |
|---|---|
| 本地文件有 file_id → 只能变 data URL | `kind=local_data_url`、`vendor_usable=False`、原因含"供应商无法访问 / data URL" |
| 公网 `https://…oss…` → 可用 | `kind=public`、`vendor_usable=True`、`reason=""` |
| `asset://` 引用 → 可用 | 同上（`kind=public`，直接透传） |
| `text_only` → 不受参考帧限制 | `required_frame_types=[]`、`unusable=[]`、`generation_blocked=False` |
| 计划预检（本地帧） | `frames[0].usable=False`、`unusable_frame_types=["first"]`、`missing_frame_types=[]`、`blocked_reason` 含 first |
| 计划预检（公网帧） | `usable=True`、不阻断 |
| 集级就绪（本地帧） | `usable_frame_types=[]`、`unusable_frame_types=["first"]`、`generation_blocked=True`、summary `frames_ready=0 / frames_unusable=1` |
| 集级就绪（公网帧 / text_only） | 前者就绪，后者不受限制 |
| 提交端兜底 | `first` + 本地帧 → `status=rejected_before_submit`、**不创建任务**；`_assert_frames_vendor_acceptable` 对 data URL 抛 400、对 http/asset 放行 |
| 供应商能力表 | `apimart=False`、`openai=True`、未知 False、`__any__`=True |

**页面定向验收（只用 S001，未发任何真实请求；脚本 `/tmp/dsh_ui/p3/n1_frame_gate_ui.py`）**：

| 动作 | 观察结果 |
|---|---|
| 选 `first` | 卡内帧行：红标 `first` + 橙标「帧已存在，但供应商无法访问」+ file_id + 原因全文；**「直接生成视频」禁用**（Playwright 点击 3s 超时＝点不动）；`blocked_reason`：「参考模式「first」的参考帧不可用：参考帧已存在但供应商无法访问：first…」 |
| 该次 `first` 操作**是否调用过** `/video-submit` | **0 次**（网络层监听为空；按钮禁用 + 计划阻断，请求根本没出去） |
| 切 `text_only` | 阻断与帧提示消失、「本镜已具备生成与导出的条件」、按钮恢复可用；**没有点击生成**（真实 `text_only` 已在 §31.6 验证过，不再重复提交） |
| 截图 | `n1_first_blocked.png`（帧行 + 原因）、`n2_first_exit_blocked.png`（出口按钮禁用）、`n1_text_only_ok.png` / `n2_text_only_exit_ok.png`（恢复） |

接口层同一次修复后的实测（只读）：

```
GET  …/prompt-board/{cid}/readiness?reference_mode=first
     → summary {"total":8,"with_prompt":8,"frames_ready":0,"frames_missing":0,"frames_unusable":8}
       S001: usable=[] / missing=[] / unusable=["first"] / generation_blocked=true
POST …/image-pipeline/video-plan/preview  (first)
     → generation_blocked=true, unusable_frame_types=["first"], frames[0].ref_kind="local_data_url"
POST …/image-pipeline/video-plan/preview  (text_only)
     → generation_blocked=false, required_frame_types=[]
POST …/image-pipeline/video-submit (first, DRY_RUN 窗口内)
     → status="rejected_before_submit"（第二层兜底先于 DRY_RUN 占位分支生效）
POST …/image-pipeline/video-submit (text_only)
     → status="dry_run"（未产生任何费用；本轮没有再发起真实提交）
```

**结论更正**（替换 §31.2 修正前的口径）：

- 8 镜的参考帧状态是「**槽位已补齐**」（8×first + S001 的 last 都在库里、有 file_id）；
- **当前 local 存储环境下，`first` 模式不是"供应商可生成"**：帧只能变成本机 data URL，APIMart 拒绝；
  要变成可生成需要把帧放到公网（配 S3/OSS 或 `local_storage_base_url`，或用 `files/external` 登记公网图）；
- 本课题里**真实通过的是 S001 的 `text_only` 路径**（§31.6：`task_01M2WDMRS5PTA9YPAYVPKNCPJN`）。

**工程收尾（本轮修复后重跑）**：后端 `pytest -q` → **577 passed / 16 failed**（失败集合与既有基线完全一致，
新增 11 条用例全过；对比修复前 566 passed）；`pylint` 本轮改动模块 **10.00/10**；前端 `typecheck` + `build` 通过（`✓ built in 17.60s`）。

### 31.11 仍未验证的完整清单（不虚报）

1. **巨日禄真实 Cookie 抓取**：无可用凭证 → **仍未验证**；本项目 8 条提示词来源如实为 `external_import`。
2. **真实 LLM 拆镜**：本项目镜头是页面手工创建 → **未验证**（在另一个小项目上曾用真实 LLM 跑过，本项目没有）。
3. **真实 LLM 资产提取**：同上，本项目走「手工新建 + 关联」→ **未验证**。
4. **真实 LLM 图片提示词生成**：本项目走第 3 步「填提示词」手工保存 → **未验证**。
5. **真实图片生成（关键帧/资产图）**：本轮参考帧与资产图都是"上传测试图" → **未验证**（付费出口，需另行授权）。
6. **公网首帧生成（`first` 真实出视频）**：本机 local 存储形成不了公网首帧 → **未验证**；
   §31.6 尝试 1 的原始报错就是证据，§31.10 的判定修复现在会在点击前就拦住它。
7. **参考音频进请求**：S001 绑定的音频是本地地址，后端明确"本次不会携带它" → **未验证**。
8. **S001 之外的 7 镜真实出视频**：只验证到"提示词/绑定/帧槽位齐 + `text_only` 可生成" → **未验证**（授权只有 1 次）。

## 三十二、真实端到端验收（2026-09-19，独立付费窗口，无自动重试）

> **与 §31 的关系**：§31 是第三部分（全程 DRY_RUN + 一次 `text_only` 出视频）的历史记录，**保留不动**。
> §31.11「仍未验证清单」是**当时**的结论快照；本节记录其后的真实端到端跑通，
> **取代 §31.11 中关于「真实 LLM」「真实图片（资产图/关键帧）」「公网首帧」的旧结论**。
> 巨日禄 Cookie 与「参考音频进请求」两条维持**仍未验证**。

### 32.1 运行边界（可复现）

| 项 | 值 |
|---|---|
| 分支 | `codex/jellyfish-production-pipeline`（唯一运行准线） |
| 后端 / 前端 | 分支后端占 `:8000`、分支前端 `vite` 占 `:5173`（主工作区的两个进程已停，仅进程层面） |
| 数据库 | **独立副本** `/tmp/jellyfish_accept/accept.db`；正式 `backend/jellyfish.db` **全程未使用**（mtime 仍为 09-19 16:51） |
| 对象存储 | 凭证只写入验证工作区 `backend/.env`（权限 `0600`，`git check-ignore` 命中，**未入库**） |
| 守卫开关 | `guard.sh paid` → `JELLYFISH_DRY_RUN=0 JELLYFISH_REAL_LLM_CONFIRMED=1`；**每个付费阶段结束立即** `guard.sh guard` 恢复守闸 |
| 终态复核 | `dry_run=true / real_call_confirmed=false` |
| 证据目录 | `/tmp/jellyfish_accept/`（`a*_log.json`、截图、`video_first.mp4`、`keyframe_first.png`、`oss_probe.png`）——**全部未加入 Git** |
| 验收项目 | `真实验收项目·整集批量（2026-09-19）` = `56384299-3e08-487d-a3c3-d46140f41794`；章节 `a5a896b5-3f5b-45ee-9a0b-9bf346812420`（剧本 321 字，**页面粘贴**） |

### 32.2 OSS 预检（免费；预检不过就不开付费出口）

| 检查 | 结果 |
|---|---|
| 应用存储检查 | 驱动 `s3`（`is_local_storage=False`） |
| **应用同源上传**极小 PNG（70 B） | `POST /api/v1/studio/files/upload` → **HTTP 201** |
| 返回地址 | `https://ai-shortdrama-assets.oss-cn-beijing.aliyuncs.com/jellyfish/acceptance/files/oss_probe.png`（**桶公网域名**，未用 path-style 回退） |
| **匿名外网读取** | **HTTP 200 / `image/png` / 70 B**（与本地探针字节一致） |
| 前缀核对 | `ListObjectsV2(prefix=jellyfish/acceptance)` 命中该对象 |
| `HeadBucket` | 仍 **HTTP 403 / Code 403 / Forbidden** → 已与用户确认记为**非阻断启动警告**，未扩权、未修改 Bucket |
| 凭证泄漏 | 日志扫描 `LTAI` / `AccessKeyId` / `aws_secret` / `X-Amz-Signature` / `Authorization:` **全部 0 命中** |

预检过程中暴露并修掉的两个**存储层真问题**（各自独立 commit，均在本次分支上）：

| commit | 现象（原始报错） | 修法 |
|---|---|---|
| `1a74c73` `fix(storage): support S3-compatible checksum handling` | botocore 新版默认 aws-chunked → OSS 返回 `400 NotImplemented: Aws MultiChunkedEncoding STREAMING-UNSIGNED-PAYLOAD-TRAILER is not supported.`（**不是权限拒绝**：同一请求去掉该默认即 200） | `BotoConfig` 增加 `request_checksum_calculation="when_required"`、`response_checksum_validation="when_required"`（保留 `addressing_style="virtual"`）+ 回归测试 |
| `b82624a` `fix(storage): resolve S3-backed objects to their public URL` | `files.storage_key` 是**逻辑 key**，S3 驱动下对象实际公网可读（实测匿名 200），但可用性判定按相对路径转 data URL → 明明公网可读却被判「供应商无法访问」 | 新增 `storage.public_url_for_key()`（**只在显式配置 `S3_PUBLIC_BASE_URL` 时**返回 `{public_base}/{base_path}/{key}`，不做 path-style 回退）；`resolve_vendor_image_ref` 先判公网 + 回归测试 |

### 32.3 真实调用分项（全部在授权上限内，**零自动重试**）

| 阶段 | 上限 | 实际 | 页面入口 / 证据 |
|---|---|---|---|
| LLM 拆镜 | 1 | **1** | 第 1 步「提取分镜」→ `POST /script-processing/divide` 200 → **9 镜**（7–10 区间），标题/摘录为模型原创 |
| LLM 资产提取 | 1 | **1** | 分镜编辑页「2 提取确认」→「提取并刷新候选」→ `POST /script-processing/extract` 200 → toast「提取完成，候选已刷新」；**7 条候选**（角色 2 / 场景 1 / 道具 3 / 服装 1） |
| LLM 图片提示词 | 1 | **1** | 资产编辑页「AI 生成图片提示词」→ `POST /studio/llm/image-prompt/preview` 200 → 9 槽位 →「保存到资产」写入 `characters.image_prompts` |
| LLM 逐镜视频提示词 | 7–10（按镜数） | **9** | 第 4 步「批量生成草稿（**9 镜**）」→ **9 次** `POST /studio/prompt-board/{cid}/draft`（**每镜 1 次请求，不是整集一次**）→ 统一预览表 **9 行** →「确认保存（9 条）」→ `save` 200：`mode=fill_empty / source=llm / applied_count=9 / skipped_count=0` |
| **LLM 合计** | **≤13** | **12** | — |
| 真实图片 | 2 | **2** | 资产图 1 + 关键帧 1（见 §32.4） |
| 真实视频 | 1 | **1** | `first` 模式 1 条（见 §32.5），`video-submit` 调用次数 = **1** |

说明（避免误读为"重试"）：过程中有两次脚本**提前中断**的尝试（提取、资产图等待），经后端日志核对 **POST 计数 = 0**（只发出过 CORS 预检），未产生任何付费调用，**不属于重试**。

### 32.4 图片：资产图与关键帧（真实 `gpt-image-2`）

**资产图 1 张**（页面：资产编辑页「多镜头图片 → 正面 → 生成 → 采纳并设版」）

| 项 | 值 |
|---|---|
| 资产 | 角色 `林晚` = `asset_1789819425398`（由真实提取候选「新建并关联」创建） |
| 通道 | `image2 → provider 模型 gpt-image-2`（后端如实回传该警告） |
| 落库 | `adopt` 200：`file_id=5ba1aeca-eb8a-4197-89d9-480a77055c05`、`is_primary=true`、`image_id=44`（FRONT） |
| 公网地址 | `https://ai-shortdrama-assets.oss-cn-beijing.aliyuncs.com/jellyfish/acceptance/generated-images/character/57fb382e831b40d38027274557bb9ae6.png` |
| 匿名读取 | **HTTP 200 / `image/png` / 1,651,244 B** |

**关键帧 1 张**（页面：工作室「关键帧与参考图 → 首帧图片 → 生成」，提示词先「保存到镜头」再生成）

| 项 | 值 |
|---|---|
| 通道 | **APIMart 直连** `gpt-image-2`（`provider=apimart`，参考图 1 张 = 上述定版图，按 `image_urls` 送出） |
| provider 任务号 | **`task_01M2WSHHGV0WH066P0XBGA7N4J`** |
| 耗时 | **57.0 s** |
| 落库 | `file_id=f3741209-4324-4b84-ba6a-e3fe2ee705ba` → 写 `shot_frame_images.first`（`image_slot_id=12`）；提示词同时写入 `shot_details.first_frame_prompt` |
| 公网地址 | `https://ai-shortdrama-assets.oss-cn-beijing.aliyuncs.com/jellyfish/acceptance/generated-images/shot_frame_image/12/20deec44f8af4e67b581817e7d46fb69.png` |
| 匿名读取 | **HTTP 200 / `image/png` / 3,297,048 B** |

### 32.5 视频：真实 `first` 模式（本项目唯一一次）

| 项 | 值 |
|---|---|
| 入口 | 本镜生产卡（镜头 1）→ 参考模式 **`first`** →「直接生成视频」 |
| **提交次数** | **1**（上游返回任务号后**未再提交**） |
| provider task ID | **`task_01M2WT7WHNQ9A7FSAF3N2KXX2N`** |
| status / 耗时 | **`completed`** / **147,051 ms** |
| 模型 / 分辨率 / 时长 / 画幅 | `seedance-2.0-mini` / **480p** / **5s** / **16:9** |
| **实际使用的首帧** | 提交路径 `file_id_to_data_url()` 解析结果 = `https://ai-shortdrama-assets.oss-cn-beijing.aliyuncs.com/jellyfish/acceptance/generated-images/shot_frame_image/12/20deec44f8af4e67b581817e7d46fb69.png`（**公网 http(s)**，非 data URL） |
| 计划预检 | `参考模式 first · 要求帧 first`、`generation_blocked=false`、帧 `usable=true / ref_kind=public` |
| 视频 URL | `https://getapib.org/video/9998210178940016-36b29c77-2fef-4dc0-b099-c9dbc19e9a3a-video_task_01M2WT7WHNQ9A7FSAF3N2KXX2N.mp4` |
| 产物核验 | **HTTP 200 / `video/mp4` / 1,955,044 B**（MP4 Base Media） |
| Jellyfish file_id | **`b436b492-a172-4f4c-8adc-ce0ec43073a1`**（`files.type=video`，已写 `shots.generated_video_file_id`；页面 toast「已生成并挂到本镜」） |

### 32.6 费用、守卫与数据安全

| 项 | 结论 |
|---|---|
| 估算费用 | **≈0.81 credits**（图片 2 张 ×0.14 + 视频 1 条 ×0.53；**供应商响应不返回 credits 字段**，按本项目文档实测单价计）→ 未突破 **1.0 credits** 上限 |
| 无自动重试 | 是；两次中断的尝试经日志核对未发出 POST（0 次），不构成重试 |
| 守卫 | 每个付费阶段结束**立即**恢复；终态 `dry_run=true / real_call_confirmed=false` |
| 敏感信息 | 凭证只在验证工作区 `backend/.env`（`0600`、被忽略）；日志/截图/汇报均不含 AK、Secret、签名 URL |
| 正式数据库 | **未使用**（全程独立副本），未删除、未改动 |
| 工程门禁 | 全量 `pytest -q` → **589 passed / 13 failed**（13 条与既有基线**逐条一致**，属信封/health 既有基线，**非本轮回归**）；改动模块 `pylint` **10.00/10**；前端 `typecheck` / `build` 通过 |

### 32.7 最终状态分类（替代 §31.11 的对应条目）

**① 已真实通过（本次取得真实证据）**

1. 真实 LLM **拆镜** → 9 镜
2. 真实 LLM **资产提取** → 7 条候选
3. 真实 LLM **图片提示词** → 9 槽位保存
4. 真实 LLM **整集视频提示词**（逐镜队列 9 次 + 统一预览 + 确认保存）
5. 真实 **资产图生成 → 采纳 → 定版**（`gpt-image-2`，公网 OSS 可读）
6. 真实 **关键帧生成**（APIMart `gpt-image-2`，公网 OSS 可读）
7. 真实 **公网首帧 `first` 视频**（`seedance-2.0-mini / 480p / 5s / 16:9`）

**② 仍未验证（保持"未验证"，不冒充）**

1. **巨日禄 Cookie 整集导入**：本轮无可用 Cookie → 未验证（**未**用外部文本导入冒充）
2. **参考音频进请求**：本轮不测试 → 未验证（供应商支持参考音频输入，但要求公网 URL / `asset://`；本轮未提供公网音频）

**③ 有意未执行（不是遗漏，是控费选择）**

1. **其余 8 镜的真实视频**：代表镜头（S001）已完整跑通 `first` 链路，按「只生成 1 条、不生成其余镜头视频」的授权执行；如需整集成片，按 §658 的量级另批（64 镜 ≈ 34 credits 的经验值可作参考）
