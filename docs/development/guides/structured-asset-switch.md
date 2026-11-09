# 资产结构化切换

本指南适用于允许移除旧描述的开发环境。升级会删除演员、场景、道具和服装的旧 `description` 列且不回填原文。先确认数据保留需求，并为仍需保留的数据做备份。降级只重建描述列，恢复原文需要升级前的备份。

1. 停止旧版本生成工作进程，确保没有需要保留执行语义的旧任务。
2. 在 `backend/` 执行 `uv run alembic upgrade head`，核对 `uv run alembic current` 与当前代码的 `uv run alembic heads`；`f2a3b4c5d6e7` 是这项历史变更的 revision，不是当前 head。
3. 启动新后端；在 `front/` 执行 `pnpm run openapi:update` 和 `pnpm exec tsc --noEmit`，然后启动或构建新前端。
4. 重启生成工作进程，使其加载分类目标、候选保存和审计快照契约。
5. 创建资产，填写分类设定与补充信息，检查描述预览。生成前更新提示词预览，确认参考图用途与编号。

迁移只更新对应类别的系统模板。用户自定义模板由维护者核对并单独修改。自定义模板必须使用 `purpose`、`description`、`visual_style`、`style`、`view_angle`、`reference_instruction`、`additional_instruction`；显示变量可使用 `framing_instruction`、`background_instruction`、`lighting_instruction`、`visible_detail_instruction`、`negative_prompt`。模板默认值和图片覆盖只接受这五个展示变量。

真实供应商验证单独确认调用上限。自动化测试不等同于视觉一致性保证；局部修改结果应在历史中检查后手动采用。
