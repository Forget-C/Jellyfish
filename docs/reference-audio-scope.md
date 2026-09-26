# 参考音频 vs 最终成片音轨（口径说明）

> 本文只讲**两件常被混为一谈的事**，以及"参考音频到底怎么进请求、什么时候被排除"。
> 本轮**没有**发起任何真实付费调用（不真实出视频、不真实出图、不真实 LLM），
> 所有验证都停在**请求计划层 + 传输层（MockTransport）**。

## 〇、权威口径来源

供应商对参考音频的契约以 `SIX_STEP_ACCEPTANCE.md` **第 128 行**（官方协议要点表）为准：

> `audio_urls` | **参考音频**（数组） | 最多 3 条、总时长 ≤15s、需与参考图/参考视频一起用、
> **只收公网 URL 或 `asset://`**、**与首尾帧图片互斥**

代码里同一份口径的既有落点：`backend/app/core/contracts/video_generation.py` 的音频字段注释、
`backend/app/core/integrations/apimart/video_capabilities.py`（`max_audio_inputs=3` /
`max_audio_seconds=15` / `audio_input_requires_reference=True` /
`audio_input_conflicts_with_frame_roles=True`）。

### 口径 vs 代码：实现状态对账（**未强制项不在本轮擅自实现**）

| 协议约束（第 128 行） | 代码状态 | 证据 / 建议改法 |
|---|---|---|
| 只收**公网 URL 或 `asset://`** | ✅ 强制 | `video_audio_input.classify_audio_input()`（本仓唯一准入函数）；`asset://` 与公网 http(s) 携带，本机相对路径/内网/供应商不吃的 data URL 排除并给原因 |
| **最多 3 条** | ✅ 强制，但**截断写死两处** | `video_audio_input.attach_shot_audio_to_video_input()` 的 `[:3]` + `apimart/video_payload.build_create_task_body()` 的 `[:3]`；能力值 `max_audio_inputs` **无人读取**。建议：截断改成读 `resolve_video_capability(...).max_audio_inputs`，一处生效 |
| **总时长 ≤15s** | ❌ **口径已在文档记录，代码未强制** | `max_audio_seconds=15` 只声明、全仓无人读；且 `files` 表**没有音频时长字段**（只有 id/type/name/thumbnail/tags/storage_key）→ 想校验必须先有数据源（上传时解析音频头写入时长）。建议：先补时长落库，再在 `attach_shot_audio_to_video_input` 里按累计时长截断/告警 |
| **需与参考图/参考视频一起用** | ❌ **口径已在文档记录，代码未强制** | `audio_input_requires_reference=True` 只声明、无人读；实测 `build_create_task_body(prompt + audio_urls)`（无任何参考图）照样发出 `audio_urls`。建议：在计划层对 `reference_mode=text_only` + 携带音频给一条明确警告（或直接不携带），并复用 `audio_input_requires_reference` |
| **与首尾帧图片互斥** | ⚠️ **部分**：提示 + 改写，不是硬拦 | `audio_input_conflicts_with_frame_roles` 被 `video_audio_input._audio_frame_conflicts()` 读取 → 产出中文冲突提示；适配器把首/尾帧改以 `image_urls` 提交（避免实测 400）。建议：若要严格互斥，需产品先拍板"拒绝"还是"改写" |

## 一、两个概念，务必分清
| | 参考音频（reference audio） | 最终成片的音轨 |
|---|---|---|
| 位置 | **输入**侧：随视频生成请求交给供应商 | **输出**侧：成片里那条声音轨 |
| 载体 | `audio_urls`（数组；seedance 协议：最多 3 条、总时长 ≤15s、需与参考图/参考视频一起用） | 供应商侧 `generate_audio`（默认 true，模型自己生成配套人声/音效/BGM） |
| 语义 | "参考"：音色 / 口型 / 说话内容（多模态参考生视频） | 成片自带的配音/音效 |
| 本轮证据 | **有**：请求计划与真实请求体（MockTransport 捕获）里能看出带没带、带的是哪个地址 | `generate_audio=false` 时成片无音轨（既有实验，见 `SIX_STEP_ACCEPTANCE.md` 五·补） |
| 是否宣称"已支持" | **不许**。只能说"会被带进请求（本轮仅在请求计划层验证）" | 不涉及 |

**另一条路径（当前未实现）**：把已经生成的配音音频**混流 / 回贴**成成片音轨
（即用我们的 mp3 覆盖/合成到成片上）。仓库里**没有**这个实现（没有 ffmpeg 调用、没有混流步骤）；
交付文本里的「声音：」行只是**清单**（列出这条镜头绑定了哪个音频文件），不代表它被混进了成片。

所以对外能说的只有一句：

> 参考音频会进入供应商请求（本轮仅在**请求计划层**验证）；供应商是否据此影响生成结果**尚无真实证据**。

计划/预览响应里的 `audio.note` 字段会原样带上这段说明。

## 二、准入口径（唯一实现）

判定只有一处：`backend/app/services/studio/video_audio_input.py` 的
`classify_audio_input()`（纯函数，不碰 DB、不发请求）。计划层、直提出视频、legacy
`/film/tasks/video` 全部复用它 —— 以前这三处各写一份"公网地址才带"的判断，
出现过 `asset://` 与内网地址结论不一致（页面说能带、提交却剔除）的问题。

| 输入 | 结论 | `reason_code` |
|---|---|---|
| 公网 `https://…` / `http://…`（非内网） | ✅ 携带 | —（`state=public_url`） |
| `asset://…`（供应商私有素材通道） | ✅ 携带 | —（`state=asset_ref`） |
| data URL，且供应商接受内嵌 base64 | ✅ 携带 | —（`state=data_url_inline`） |
| 本机相对路径（`/files/x.mp3`、`files/x.mp3`） | ❌ 排除 | `local_path` |
| 内网 / 本机地址（`127.` `10.` `172.16-31.` `192.168.` `169.254.` `localhost` `*.local`） | ❌ 排除 | `private_address` |
| data URL，而供应商不接受（APIMart） | ❌ 排除 | `data_url_rejected` |
| 供应商/模型不接受参考音频 | ❌ 排除 | `vendor_unsupported` |
| 解析不出任何可用地址（对象读不到 / 没配公网基址） | ❌ 排除 | `no_address` |
| 绑的 `file_id` 在素材库里查不到 | ❌ 排除 | `file_missing` |
| 没绑定 | ❌（明确写「未绑定」） | `not_bound` |
| 明确标记「本镜无需声音」 | ❌（是表态，不是漏绑） | `opt_out` |

排除一律**不静默丢弃**：`excluded_reason`（原因）+ `how_to_fix`（怎么修）跟着计划一起返回，
页面在**提交之前**就显示「已绑定，但供应商无法访问」。

补充：`asset://` **不做匿名探活**（供应商侧用自己的凭据解析，我们探不到）。
探活实现只有一份（`reference_preflight.probe_reference_url`），`asset://` 在候选抽取阶段
就被跳过（`video_submit._should_probe_media_url`），否则会被按"本机/相对路径"误杀。

## 三、计划 / 预览响应里的审计字段

`POST /api/v1/studio/image-pipeline/video-plan/preview` 的响应 `data.audio`（**只增字段**，
既有 `audio_file_id` / `audio_url` / `audio_state` / `audio_opt_out` 原样保留）：

```json
{
  "audio_file_id": "file-****",
  "audio_url": "",
  "audio_state": "bound_not_public",
  "audio": {
    "included": false,
    "file_id": "file-****",
    "url": "",
    "declared_url": "http://192.168.1.9:8000/static/voice.mp3",
    "excluded_reason": "已绑定声音「验收配音」（file_id=file-****），但它指向本机/内网地址（192.168.1.9）：别人的服务器一定取不到，本次生成请求不携带它。",
    "reason_code": "private_address",
    "how_to_fix": "请换成公网可访问的 http(s) 地址（OSS 等），或改用供应商的 asset:// 素材通道。",
    "state": "private_address",
    "vendor_supports_reference_audio": true,
    "note": "「参考音频」与「最终成片的音轨」是两件事：…"
  }
}
```

- `included`：本次请求是否真的会携带（`audio_urls` 里有没有它）；
- `file_id`：绑定的音频 file_id；
- `url`：**会进请求**的地址（公网 http(s) / `asset://` / 供应商接受的 data URL）；不携带时为空；
- `excluded_reason`：没带的原因（未绑定 / 本机路径 / 内网 / data URL / 供应商不支持…）；
- `declared_url`：解析出的原始地址（可能是本机/内网，仅供技术详情，不会发给供应商）；
- `reason_code` / `how_to_fix` / `state`：机器可读原因码、修法、准入状态。

legacy 预览端点 `POST /api/v1/film/tasks/video/preview-prompt` 也返回同一份
`audio` 与 `audio_warnings`（用的是同一个函数，只是供应商/模型按该路径真实使用的默认视频模型解析）。

## 四、`SIX_STEP_ACCEPTANCE.md` 内部与第 128 行不一致的地方（**只报告，不改那个文件**）

收口时需要统一的下述行号（以 `SIX_STEP_ACCEPTANCE.md` 为准）：

1. **第 140 行**「只有**公网绝对地址**才进入 `audio_urls`」—— 漏了 `asset://`，与本文件第 128 行
   （"只收公网 URL 或 `asset://`"）以及现有代码（`classify_audio_input` 允许 `asset://`）矛盾。
2. **第 141–143 行**提示文案里写"或改用 `asset://` 通道"，与第 140 行的"只有公网绝对地址"自相矛盾
   （同一段落内前后不一致）。
3. **第 144–145 行**「同时带了首/尾帧时会附一条**互斥冲突提示**……**不静默改写用户的入参**」
   —— 与 **第 183–184 行**（"现在有音频时自动把首/尾帧改以 `image_urls` 提交"）以及现有代码矛盾：
   落库前的 `run_args` 确实不改写，但**适配器层会改写发给供应商的请求体**。措辞需明确
   "哪一层不改写、哪一层改写"。
4. **第 160–161 行**「用参考音频时**不能同时用首尾帧图片**（官方互斥），需要按 `reference_mode=first`
   之类的参考图方式使用」—— 与第 183–184 行的"改写为 `image_urls` 后可同时使用"矛盾（一个说不能，一个说改写后就行）。
5. **第 151 行**「`tests/test_video_audio_input.py`（12 条）」—— 计数已过期（该文件现收集到 **14 条**），
   本轮另外新增 `tests/test_video_audio_scope.py`（**32 条**）覆盖准入/审计/请求体捕获。
6. 术语上不矛盾、但容易误读：**第 188–197 行**的"`generate_audio` 决定成片有没有音轨"是**输出侧**结论，
   与第 128 行的输入侧 `audio_urls` 是两件事；第 199 行起已有"更正/撤回"段落，建议在第 188 行的标题里
   就点明"输出侧"，避免读者只看到结论。

## 五、本轮验证到哪一步（不谎报）

已证明（可复跑）：

1. 公网地址 → **真实构造出来的**请求体里 `audio_urls` 有该值
   （`httpx.MockTransport` 捕获，走真实 `build_run_args` + 真实 `VideoGenerationTask`）；
2. 本机相对路径 / 内网地址 → 请求体里**没有** `audio_urls`，且计划里给出排除原因；
3. `asset://` → 请求体里有该值，且不被匿名探活误杀；
4. 未绑定 / 无需声音 / data URL 各按上表判定；
5. 前端纯函数用例覆盖「已绑定，但供应商无法访问」的显示条件与文案。

**仍未验证**（需要真实付费出视频才能证明，本轮未做）：

- 供应商是否**真的接受**参考音频并据此影响生成结果（例如口型/音色）——包括"改写首尾帧为 image_urls 之后参考音频是否被采用"；
- 让参考音频"逐字成为成片音轨"是否可行（这需要另做混流路径，且与"参考音频"是两件事）。

复跑命令见 `backend/tests/test_video_audio_scope.py` 文件头注释。
