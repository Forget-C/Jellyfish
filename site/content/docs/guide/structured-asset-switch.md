---
title: 资产结构化切换
description: 在无历史数据兼容要求的开发环境中应用分类资产字段、模板和客户端更新。
---

# 资产结构化切换

此变更不保留历史描述：会删除演员、场景、道具和服装的旧 `description` 列。只在确认无需保留这些内容的环境中执行；降级无法恢复旧描述。

1. 停止旧版本生成工作进程，确保没有需要保留执行语义的旧任务。
2. 在 `backend/` 执行 `uv run alembic upgrade head`，核对 `uv run alembic current` 与当前代码的 `uv run alembic heads`；`f2a3b4c5d6e7` 是这项历史变更的 revision，不是当前 head。
3. 启动新后端；在 `front/` 执行 `pnpm run openapi:update` 和 `pnpm exec tsc --noEmit`，然后启动或构建新前端。
4. 重启生成工作进程，使其加载分类目标、候选保存和审计快照契约。
5. 创建资产，填写分类设定与补充信息，检查描述预览。生成前更新提示词预览，确认参考图用途与编号。

系统模板会随 revision 更新。自定义模板必须使用 `purpose`、`description`、`visual_style`、`style`、`view_angle`、`reference_instruction`、`additional_instruction`；显示变量可使用 `framing_instruction`、`background_instruction`、`lighting_instruction`、`visible_detail_instruction`、`negative_prompt`。模板默认值和图片覆盖只接受这五个展示变量。

真实供应商验证单独确认调用上限。自动化测试不等同于视觉一致性保证；局部修改结果应在历史中检查后手动采用。
