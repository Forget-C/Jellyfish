# 资产结构化切换

本指南适用于允许移除旧描述的开发环境。升级会删除演员、场景、道具和服装的旧 `description` 列且不回填原文。先确认数据保留需求，并为仍需保留的数据做备份。降级只重建描述列，恢复原文需要升级前的备份。

1. 停止旧版本生成工作进程，确保没有需要保留执行语义的旧任务。
2. 在 `backend/` 执行 `uv run alembic upgrade head`，核对 `uv run alembic current` 与当前代码的 `uv run alembic heads`；`f2a3b4c5d6e7` 是这项历史变更的 revision，不是当前 head。
3. 启动新后端；在 `front/` 执行 `pnpm run openapi:update` 和 `pnpm exec tsc --noEmit`，然后启动或构建新前端。
4. 重启生成工作进程，使其加载分类目标、候选保存和审计快照契约。
5. 创建资产，填写分类设定与补充信息，检查描述预览。生成前更新提示词预览，确认参考图用途与编号。

迁移只更新对应类别的系统模板。用户自定义模板由维护者核对并单独修改。自定义模板必须使用 `purpose`、`description`、`visual_style`、`style`、`view_angle`、`reference_instruction`、`additional_instruction`；显示变量可使用 `framing_instruction`、`background_instruction`、`lighting_instruction`、`visible_detail_instruction`、`negative_prompt`。模板默认值和图片覆盖只接受这五个展示变量。

真实供应商验证单独确认调用上限。自动化测试不等同于视觉一致性保证；局部修改结果应在历史中检查后手动采用。

## 项目专属资源与图片文件夹切换

`a714d2c98e31` 接在 `f2a5d8e71c40` 之后。升级前备份数据库及文件存储，停止 API 写入与生成 Worker，再运行上述升级命令并同步发布前后端；不能运行旧模型代码写入新表结构。本迁移不能自动降级，回滚需恢复升级前备份及对应版本应用。

实际清理包括 `character_prop_links`、角色 `actor_id`／`costume_id` 外键列，以及场次 `object_preparation` 中旧演员 `reference_source`。保留角色身份、自身描述、所有图片和历史任务、场次具体 `image_file_id`。历史共享对象仍为共享；新对象按创建范围归属。主图优先保留原标记，否则按正面和既有顺序回填；旧右侧等角度不重标。同角度唯一限制移除，名称改为类别内归属范围唯一。

升级后通过 API 核对库与项目列表、旧场次文件、图片角度与主图，再验证专属新建、独立主图采用和入库副本。隔离 MySQL 8.0.39 已验证该迁移及同名并发入库的409冲突、同来源重试幂等；这不代表已升级运行中的业务数据库。
