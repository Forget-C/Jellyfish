# AI 工作流

Jellyfish 的 AI 能力包括文本处理与实体提取、场次设计与提示词生成，以及图片和视频生成。

- `app/chains/` 维护提示词、Agent 和工作流图。
- `app/services/` 组织业务实体和 AI 调用。生成服务负责提交任务、固定执行输入并将结果交付给对应业务；场次、资产、实验室及生成画布保留各自的入口和上下文。
- `app/task_worker.py` 独立运行，从持久化任务表领取任务并推进执行。媒体供应商调用由 `app/core/integrations/` 适配，公共契约由 `app/core/contracts/` 提供。

执行状态和恢复边界见[任务执行架构](task-execution.md)；新增供应商见[供应商注册与扩展](../guides/llm-provider-registration.md)。
