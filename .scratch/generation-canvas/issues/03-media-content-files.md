# 03: 四类内容卡与项目媒体导入

Status: ready-for-agent
Blocked by: 01

**What to build:** 用户可创建图片、视频、音频内容卡，上传、替换或选用项目文件并预览；失败和迟到响应不丢失已有内容或复活删卡。

**依据：** [实现规格](../spec.md)；[任务依赖与共同验证](../README.md)。验收覆盖：A05。

## Acceptance criteria

- [x] 文本、图片、视频、音频内容卡均只有输出、一卡一份；空媒体卡可保存，不发布有效输出。
- [x] 复用项目文件上传／查询和已有预览能力，补齐后端文件类型、校验及前端音频导入／播放；不把音频当图片走兜底分支。
- [x] 上传中无有效输出；失败保留卡片和重试入口；替换失败保留原文件。
- [x] 上传成功即进入项目文件库，即使画布保存失败仍可重选；上传期间删卡，晚回包不重建卡，文件仍留项目库。
- [x] 内容卡保存使用真实项目文件引用并保护在用文件；不能绕过项目归属／文件存在性检查。
- [x] 增加显式清理上传保留关系的入口，释放前检查其他引用；放弃编辑不自动删除文件，不引入临时租约。
- [x] 来源内容替换保持输出位置身份，文件删除与卡片删除分别处理；基础卡不新增数据输入。

## Validation

- HTTP＋存储替身验证四模态、归属、文件引用、上传与保存分离。
- 浏览器覆盖上传失败、替换失败、上传中删卡、保存失败后从文件库重选和音视频预览。
- 既有图片／视频文件接口完成必要回归，音频支持同步 OpenAPI。
- 执行 [共同检查要求](../README.md#共同检查要求) 中适用于本票变更的命令，并记录真实结果。

## Scope and handoff

为 05 的引用候选及 08／09 的生成输入提供文件与内容输出契约。运行历史和等待节点的文件保护在相应运行票接入，12 验证完整清理生命周期。

## Comments

- 2026-10-23：依据已确认术语和 ADR 建立实现票据，尚未开始实现或执行验收。


- 2026-10-23：实现完成，A05 已通过真实 HTTP 与浏览器验收。新增三种媒体内容卡（file_id 可空、uploading 阻止输出），保持原卡和输出位置；保存验证真实文件类型、可用性与项目归属，canvas_content usage 与上传保留各自保护文件。上传、替换或保存失败不丢原文件，迟到上传不重建已删除卡；项目库可选用已上传文件。音频使用原生 audio 播放，项目 FilesTab 明确处理音频。
- 2026-10-23：显式清理入口为 DELETE /api/v1/studio/files/{file_id}/upload-retention?project_id=...，只释放本项目 generation_upload；其他真实引用存在时拒绝（409），移除引用后可重试。释放后仍须显式文件删除才登记字节清理，避免把清理上传保留误作删除在用文件。
- 2026-10-23：TDD red：新增 HTTP 测试先得到音频上传 400、媒体保存 422；不存在项目的上传先错误得到 201。对应实现后 green：`S3_BUCKET_NAME=test /Users/extreme/Projects/github.com/jellyfish/backend/.venv/bin/python -m pytest tests/test_generation_canvas_api.py tests/test_studio_files_service.py -k 'not mysql' -q`（backend 目录）19 passed、1 deselected；覆盖三媒体真实上传／替换／清空／上传中保存、项目归属、缺失／错类型文件、独立项目库及保留释放。未重新运行与本票无新增竞争逻辑的已有 MySQL CAS 测试。
- 2026-10-23：合入最新集成分支 dcd60bd 后 `pnpm --dir front run typecheck` PASS；`PLAYWRIGHT_CHANNEL=chrome UV_PROJECT_ENVIRONMENT=/Users/extreme/Projects/github.com/jellyfish/backend/.venv node front/tests/run-browser.mjs generation-canvas-media` PASS（preflight 1.0s、媒体 5.8s），验证上传失败、替换失败原文件、保存失败后库选、删除卡后迟到成功及文件库保留、真实 WAV／带音轨 MP4 加载和播放。证据 `/private/tmp/jellyfish-generation-canvas-evidence/03/final`。
- 2026-10-23：`PYLINTHOME=/tmp/jellyfish-pylint-03 /Users/extreme/Projects/github.com/jellyfish/backend/.venv/bin/pylint app`（backend）PASS，10.00/10。OpenAPI 及 generated client 已从本工作区 app.openapi() 同步作开发验证，未占用现有 8000；最终集成仍按项目要求核实当前 8000 后运行 openapi:update。
