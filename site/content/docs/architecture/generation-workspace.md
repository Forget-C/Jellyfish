---
title: 生成准备架构
description: 场次单元、资产图片与实验室的当前生成边界
---

## 场次生产

当前场次版本保存可编辑六岗设计、生产单元及指令正文。单元明确动作范围、模型、时长、画幅、真实参考和连续性依赖；AI 建议必须明确应用，不能替代保存或执行授权。指令依据核对、检查及视频提交分别记录，提交时固定实际使用的内容与输入，后续编辑不会改写已受理任务。

旧已确认设计、生产计划及不可变 PromptRevision 属于[固定版本契约](https://github.com/Forget-C/Jellyfish/blob/main/docs/development/architecture/directing-fixed-records.md)，不是当前四画布需要重复执行的逐层确认流程。

提交与 Worker 执行都校验输入身份、模型能力和实际连续性证据。生成成功登记 Take，审片覆盖和剪辑采用另行保存。没有旧镜头槽位提交、自动采用或在 Worker 再追加镜头指导的旁路。完整契约见[场次工作台核心数据与版本](https://github.com/Forget-C/Jellyfish/blob/main/docs/development/architecture/directing-foundation.md)。

## 资产图片

`services/studio/generation/asset_image` 继续按 `build_base`、`build_context`、`derive_preview`、`build_submission` 组织生成准备；共享结构位于 `shared`。资产事实、提示词预览和最终提交参数分别表达。

`services/generation/prompts` 只注册资产图片 Renderer，前端通过 generated client 请求预览与生成。`AssetImagePublisher` 按槽位版本执行条件更新；生成时选择候选则保存结果供后续明确采用。项目资产关联位于 `/api/v1/studio/project-assets`，不携带旧镜头 ID。

资产图片存在不代表自动成为视频输入。场次生产单元显式绑定文件、用途、人物、顺序和输入角色，经编译与能力检查后才进入供应商请求。

## 实验室与通用执行

实验室保持独立的模型试验入口，不自动写入场次设计或粗剪。资产和场次复用通用任务、供应商适配和文件归档；模型参数及媒体契约位于 `app/core/contracts`，执行编排不定义跨层 DTO。任务状态和结果交付边界见[任务执行架构](/docs/architecture/task-execution/)。

旧 `services/studio/generation/frame`、`video` 和 ShotDetail 摄影字段已移除；画幅及时长由当前生产单元表达，不再从旧镜头字段派生。
