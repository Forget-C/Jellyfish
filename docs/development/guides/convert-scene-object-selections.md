# 转换场次对象的旧单图准备

场次对象准备使用项目资源身份，画布动态参考经提取对象解析该资源的当前图片。旧准备中的 `image_file_id`、`reference_source` 不再由普通读取兼容；维护者须显式预检、确认范围后转换。领域边界见[对象引用决策](../adr/0009-scene-object-resource-references.md)，目标行为见[对象选用设计](../design/scene-object-resource-selection.md)。

## 只读预检

在 backend 目录运行，默认读取该检出的应用配置，命令不初始化数据库、不调用供应商、不打印连接串或正文：

```sh
uv run python -m app.scripts.convert_object_selections --output /private/tmp/object-selection-plan.json
```

MySQL 使用 READ ONLY 事务，SQLite 使用 query_only，查询后回滚。输出新建 0600 文件，包含场次与对象身份、准备修订及完整内容前后摘要、对象动作、拟释放及保留的精确文件使用记录 ID。输出路径已存在会失败，需使用新路径，不覆盖既有审批资料。

核对计划的每个对象动作：`convert` 仅去除单图字段；`add_member` 把归属可证明的本场独立上传加入资源成员，保留现有主图及角度默认；`clear_conflict` 清空不合法或无归属证据的资源选用而保留提取资料；`remove_conflict` 仅适用于无法成为合法提取对象的冲突记录。不得以名称猜测归属，也不因记录冲突而扩大删除到画布、任务、资源或文件。

仅释放列出的 `scene-object:<场次>:<对象>` 的 `directing_reference`；其他文件使用记录及文件实体保持不变，generation_upload 也不默认删除。正常固定图片引用与历史任务继续独立，不自动改为动态引用。计划审批前核对具体影响和保留依赖，实际数据变更须取得对应精确范围确认。

## 明确执行

确认后计算计划文件的 SHA-256，提供该摘要及全新的私有恢复和结果路径：

```sh
shasum -a 256 /private/tmp/object-selection-plan.json
uv run python -m app.scripts.convert_object_selections --apply \
  --plan /private/tmp/object-selection-plan.json \
  --expected-sha256 '<审核过的计划文件摘要>' \
  --backup /private/tmp/object-selection-backup.json \
  --output /private/tmp/object-selection-result.json
```

执行先锁定并核对当前准备和计划身份，私有备份包含原始准备正文和将释放的使用记录。备份失败不修改数据库；计划或数据漂移拒绝执行，须重新预检和确认。转换在单一事务内提交，不删除物理文件或改写画布、历史任务。执行结果写出失败时，不能凭缺少结果文件就假定事务未提交，须通过公开读取和重新预检核实。

每个准备去除旧字段并递增一次修订，提取对象原身份、名称、描述、出处保留；成员补入不覆盖现有主图或角度默认，需要时在资源详情明确维护。重复执行同一计划时，仅在所有目标仍为预期转换后摘要时返回 already_applied；其他变化拒绝重放。

## 核验与恢复

通过公开场次对象读取确认新修订、故事身份、资源选用和当前主图；通过动态画布参考读取确认资源可被解析。再次只读预检应无已处理候选；核对保留的文件使用记录、已有画布和任务仍然存在。完整生产链路的隔离 API／真实任务测试覆盖任务受理时固定用图，浏览器对象参考测试覆盖对应页面状态。

恢复资料只用于精确维护，不是自动兼容入口。需要回退时先停止相关写操作，对照准备修订及补入成员确认是否已有后续编辑；不得覆盖之后的新选择或直接删除已被其他位置使用的成员。仅恢复本次确实改变的准备和使用记录，发生漂移先审阅新的影响范围，不自动执行宽泛回滚。
