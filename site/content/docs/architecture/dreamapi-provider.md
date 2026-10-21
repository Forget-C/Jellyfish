---
title: "DreamAPI 图片/视频生成适配器"
weight: 8
description: "DreamAPI BYOK 的任务数据流、已覆盖模型与共享任务契约边界。"
---

## 架构与数据流

DreamAPI 作为 `ProviderKey` 内置值，通过现有 LLM Provider 管理页配置自己的 API Key。`provider_resolver` 按模型类别解析 Provider 与 Base URL；`core/tasks/bootstrap.py` 将 `image_generation` 和 `video_generation` 分派到各自 DreamAPI Task，之后由 `core/integrations/dreamapi/` 适配器调用 DreamAPI 异步 API、轮询结果并返回共享结果契约。

图片或视频任务的业务层继续负责任务状态与结果持久化：图片由 `services/studio/image_task_runner.py::_persist_images_to_assets` 保存到素材资产；分镜视频由 `services/film/generated_video.py::persist_generated_video_to_shot` 保存到文件素材并关联分镜。适配器不改变这两条存储流程。

本地 data URL/base64 图片先走 DreamAPI Storage 的 policy → OSS multipart upload → finish 三步取得 HTTPS URL。服务端 API Key 只发给 DreamAPI 的 API 域名，用于取上传策略、完成上传和提交/轮询任务；不会加到 OSS multipart 字段。已有 HTTPS 图片引用不会被下载或重新上传。

## 支持的模型名与模式

在 `/models` 的 **模型**标签中把下列名称绑定到 DreamAPI 供应商。输入图片按 `images` 数组顺序传入；对有固定角色的接口，顺序是契约当前能表达的角色映射。

| 类别 | 模型名 | 支持模式 | 备注 |
|---|---|---|---|
| 图片 | `seedream-4.0`、`seedream-4.5`、`seedream-5.0-lite`、`seedream-5.0-pro` | 文生图、参考图生图 | 按版本校验尺寸关键词与像素范围；最多 10 张参考图。 |
| 图片 | `flux` | 文生图、单图生图 | 参考图有无决定路由；宽高必须为 16 的倍数，单边不超过 1600。 |
| 图片 | `dreamimage-2.0` | 单图自然语言编辑 | 需要恰好 1 张参考图。 |
| 图片 | `nano-banana-2`、`nano-banana-pro` | 文生图、多图参考生成 | 分别映射 Gemini 3.1 Flash Image Preview / Gemini 3 Pro Image Preview。 |
| 图片 | `gpt-image-2` | 文生图、多图参考编辑 | 最多 4 张参考图；契约不含质量档位，固定使用上游 `low`。 |
| 图片 | `gpt-image-2.5-flare-text-to-image`、`gpt-image-2.5-flare-image-to-image`、`gpt-image-2.5-sunburst-text-to-image`、`gpt-image-2.5-sunburst-image-to-image` | Flare/Sunburst 文生图、图生图 | 图生图最多 4 张；固定 `low` 质量。 |
| 图片编辑 | `colorize`、`enhance`、`remove-background` | 单图上色、增强、抠背景 | 各要求 1 张输入图。 |
| 图片编辑 | `swap-face` | 图片换脸 | 顺序为 `[目标图, 来源人脸图]`。 |
| 图片编辑 | `virtual-try-on` | 试衣 | `[模特图, 连体衣]` 或 `[模特图, 上装, 下装]`；未指定尺寸时不覆盖上游默认值。 |
| 视频 | `dreamvideo-3.0` | 文生视频、首帧图生视频、首尾帧生成 | 3–15 秒；契约提供的画幅集合有限，不传分辨率覆盖值。 |
| 视频 | `wan2.1` | 文生视频、单首帧图生视频、首尾帧生成 | 固定 5 秒、16:9；文本/首帧模式用 `480p`，首尾帧模式不传分辨率并沿用上游默认。 |
| 视频 | `seedance-2.0`、`seedance-2.0-mini`、`seedance-2.5` | 文生视频、首帧图生视频、首尾帧生成 | 分别校验 4–15 秒、4–15 秒、4–30 秒；因共享输入无分辨率字段，固定使用 `480p`。 |

上游参数边界：`virtual-try-on` 只接受模特/服装图和可选输出尺寸，不支持通用图片提示词，因此适配器不会发送 `prompt`。Seedance 2.5 同时提供首尾帧时，上游固定将画幅设为 `adaptive`，即使工作台选择了其他比例；DreamVideo 3.0 的随机 `seed` 只允许 `-1` 或正整数，适配器会拒绝 `0`。

兼容性按任务契约与 DreamAPI 请求字段交集实现。输入合同只提供图片 `prompt/images/size/n/seed/target_ratio`，不提供图片编辑的泛化参数、试衣角色枚举或扩图四边像素；视频合同提供 `prompt/first_frame_base64/last_frame_base64/key_frame_base64/ratio/seconds/seed/watermark`，但没有音频或源视频输入，也没有分辨率、参考视频列表或音频生成开关。DreamAPI 适配器拒绝非空 `watermark` 和单独的 `key_frame_base64`，因为已映射路由没有等价参数；图片统一结果返回 URL，不承诺 `b64_json`。

部分图片接口本身没有尺寸或画幅参数（如 DreamImage 2.0、Colorize、Enhance、Remove Background），因此共享任务的 `size/target_ratio` 不会改变这些接口的上游默认输出；Nano Banana、Seedream、Flux 与 GPT Image 则会映射其各自支持的画幅/尺寸参数。图片统一结果返回 URL，素材落库仍由 Jellyfish 现有业务层负责。

因此目前不接入：图片 Outpainting（缺少 `outPaintSize.left/right/top/bottom`）；Seedance 的参考视频/音频、`generateAudio` 与 `omni-reference-task-type`；LipSync、DreamAvatar、Dreamact、视频翻译、视频换脸/抠像/合成/去水印/增强等依赖源视频或音频输入的任务。需要扩展公共契约和产品 UI 后，才能逐项评估新增。

上游接口参考：[DreamVideo 3.0](https://api.newportai.com/api-docs/dreamvideo-3.0)、[Wan 2.1 文生视频](https://api.newportai.com/api-docs/text-to-video-wan2-1)、[Wan 2.1 图生视频](https://api.newportai.com/api-docs/image-to-video-wan2-1)、[Seedance 2.0](https://api.newportai.com/api-docs/seedance-2.0)、[Seedance 2.5](https://api.newportai.com/api-docs/seedance-2.5)、[Virtual Try-On](https://api.newportai.com/api-docs/virtual-try-on)、[Outpainting](https://api.newportai.com/api-docs/outpainting)。

## BYOK 密钥存储注意事项

Provider 管理响应 DTO 不返回 `api_key` / `api_secret`，但现有异步任务入口会把 provider API Key 复制到 `GenerationTask.payload.run_args` 并持久化，worker 执行时从该载荷读取；同一载荷也可能包含任务输入和媒体引用（分镜视频帧会先转成 data URL）。当前实现没有对这些字段做加密或统一脱敏。运维应保护 Provider 和任务数据表、备份及数据库访问；不要开启包含请求头/任务载荷的明文日志。代码/测试使用的只能是明显的假值，不得提交真实密钥。

自动化适配器测试全部使用 `httpx.MockTransport`，验证路由/请求映射、Storage 上传顺序、凭据不进入 OSS 请求以及响应解析；它们不验证真实账户权限、实时价格或 DreamAPI 线上可用性。
