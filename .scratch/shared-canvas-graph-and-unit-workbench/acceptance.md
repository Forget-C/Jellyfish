# 共享 graph 与单元画布验收记录

状态：既有功能与回归证据已汇总；首次两轴审查发现四项需修正，见 review.md。以下通过结果仅描述已执行证据，不代表审查已通过或最终结项。母规格保持原文；以下沿用 A01–A20，不缩减范围。详细红绿过程及早期证据见 implementation.md。

## 当前验证范围

- 后端全仓：785 passed、19 skipped；随后新增导演计数契约，全部 directing 消费者 500 passed、15 skipped；新增历史无 ID HTTP 用例单独通过。非 directing 模块没有进一步改动。
- 全应用 Pylint：10.00，退出成功。前端 typecheck、diff --check 通过。
- 前端纯逻辑全集：182 passed、0 failed、0 skipped。其后 UI 变化通过下列真实浏览器验证，纯逻辑模块没有再次修改。
- OpenAPI 从已核实加载当前工作区的 8000 后端生成，generated client 同步；清理无关生成换行差异。
- 浏览器使用真实前端、隔离数据库与正式 HTTP 服务，付费模型生成由既有受控夹具替代；媒体上传、读取及解码实际执行。所有列为通过的句柄均已结束。

## A01–A20

| 编号 | 证据与判断 |
| --- | --- |
| A01 | `test_unit_graph_filters_share_one_unit_and_keep_its_complete_subgraph` 保存跨镜头及同镜头多个出现项，核对完整子图、唯一单元与 execution_scope_supported=false；graph 浏览器在过滤与进入后仍显示完整覆盖。一镜多单元在版本和视频完整浏览器实际使用。通过。 |
| A02 | `directorLayout.browser.mjs` 验证布局缓存、导航与手动位置；`sceneCanvasGraph.browser.mjs` 验证单元全场／镜头／子图、后退／前进、聚合预览和不透明视图 ID。共同 GraphCanvas、useGraphLayout、useGraphBrowse 真实被两画布消费。通过。 |
| A03 | graph 浏览器验证精确 URL、失效目标无替代、导演指定镜头、正常入口恢复筛选、only-B 单元在 A 筛选下直达指令；视频浏览器验证通知及原版本／执行回跳。工作台已消除 coverage[0] 入口推导。通过。 |
| A04 | graph 浏览器验证全部镜头新增先选目标、单镜头直接新增、AI 目标明确且多覆盖来源保持原身份并禁用；`sceneUnitDesign.browser.mjs` 完成真实 AI 预览、确认／取消、手动／自动保存及在途编辑保护。通过。 |
| A05 | graph 浏览器逐项编辑第二 coverage、模型配置、种子、组织进入／结束／参考要求及依赖入口，关闭重开与保存回读身份一致；版本浏览器验证真实参考编辑。详情使用当前内容，卡面使用后端基线。通过。 |
| A06 | `test_unit_reference_graph_preserves_binding_roles_order_and_live_file_evidence` 验证同文件跨单元独立绑定、用途／角色／ordinal 及移除；graph、版本和视频浏览器实际上传、选择、预览并绑定素材，组织需求保持待准备文字。通过。 |
| A07 | `test_unit_graph_basis_keeps_partial_execution_background_and_production_phases` 与 unit_scope、instruction_destinations 测试验证部分动作、六岗范围、视频／声音／后期分区；graph 浏览器以只读详情定位覆盖和导演真实字段，并验证组织 exit_state 实际焦点。通过。 |
| A08 | graph HTTP 测试验证同 revision 的模型名称／供应商、文件删除和风格适用证据变化；scene_dependencies HTTP 验证 plan 与 scene 固定落幅及单元隔离；sceneFrameDependencies 浏览器验证真实区间变化后的待复核与执行门禁。结构完整不替代真实检查。通过。 |
| A09 | 新 legacy HTTP 用例验证重复内容无 ID 旧行读取不补身份、同 revision 地址稳定、保存后临时 ID 集合不复用；共同契约验证外部历史目标；完整版本浏览器覆盖来源历史、只读与交接。不可变修订继续由既有后端全集测试保护。通过。 |
| A10 | `test_common_graph_contract_rejects_invalid_references`、非法字段／历史来源／重复构建器测试和两类具体 graph 的共同校验验证重复身份、悬空引用、边来源、入口、锚点、层级、版本与编辑地址。通过。 |
| A11 | scenePeriodicSave 受控时钟验证持续输入时 5 秒检查、无变化无请求、手动和周期不重叠、四画布共享队列。通过。 |
| A12 | 同一浏览器验证 A 发送后 B 留在编辑器，A 响应只推进基线；下一请求使用新 revision。两类 graph 的响应失配重试组合也验证 B 不被当作已保存。通过。 |
| A13 | 周期保存验证网络失败保留提示／输入并原样重试 request_id、expected_revision、内容；B 不并入旧请求。完整版本与视频浏览器覆盖未知请求重开及原授权重放。通过。 |
| A14 | 周期保存验证 422 等修正、409 显式冲突且不盲目重试；版本浏览器验证服务端已推进时不直接覆盖。后端并发／幂等用例通过。通过。 |
| A15 | 完整版本浏览器验证关闭／重开、原请求成功／未到达、追加输入、另一恢复记录、存储失败及服务端变更；graph 浏览器新增单元明确 422 后实际关闭页面、同浏览器重新打开并恢复。通过。 |
| A16 | graph 浏览器验证未保存新增单元失败后关闭详情再进入、实际关闭恢复、无前端假节点／无强制保存；恢复后保存，再撤销移除该单元，旧图参考入口明确不可用，不选其他单元，重做恢复原输入。通过。 |
| A17 | 共同布局缓存与导演布局浏览器验证稳定节点位置；graph／周期保存浏览器验证最新输入和服务端基线分离、两图更新及四画布切换；完整版本浏览器验证保存后撤销／重做仍保留。通过。 |
| A18 | graph 浏览器验证初次缺失 unit_graph 明确错误、不拼图；周期保存分别损坏 director_graph／unit_graph revision，保留输入并核验原请求；版本浏览器覆盖损坏关系图、只读和存储不可用。通过。 |
| A19 | sceneVideo 完整旅程验证保存并生成响应丢失、原授权重放、其他单元继续编辑、刷新核验及无重复生成；存储保护失败时没有提交新生成意图。通过。 |
| A20 | 最新 sceneVideo 从单元页实际配置模型／时长和真实上传参考开始，再核对正文、六岗检查、预检／生成、返回候选并实际播放、读取失败重试及适用性复核；生成不自动采用。既有剪辑／审查门禁继续通过后端和工作台浏览器验证。通过。 |

## 可定位的浏览器证据

以下路径均位于 `/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/`：

- 最新 graph、跨镜头 AI 门禁、异常图、关闭恢复及撤销旧图入口：`jellyfish-canvas-graph-YdEns3`。
- 配置／上传参考到视频候选的完整闭环及未知生成授权：`jellyfish-scene-version-dcS5E7`。
- 最新 AI 单元设计完整生命周期：`jellyfish-scene-version-UNRwnS`。
- 完整版本、保存、恢复、冲突、存储与多页面交接：`jellyfish-scene-version-iyd28F`。
- 两类 graph 异常响应、A/B、周期／手动保存和冲突：`jellyfish-periodic-save-kIfdBr`。
- 工作台组件／键盘／弹窗：`jellyfish-workbench-ui-0DfBRA`；真实页面四画布／窄屏／媒体／时间线：`jellyfish-workbench-style-XLt2sv`。
- 设计完整性、正常／指定镜头进入及恢复筛选：`jellyfish-design-scope-nMg8Ob`。
- 真实场次落幅依赖及独立单元门禁：`jellyfish-scene-version-JNSHBc`。
- 导演布局、缓存和导航：`jellyfish-director-layout-gJXxq5`。

## 复用与边界审计

后端契约没有 I/O，GraphAssembler 不做鉴权，CanvasReadContext 固定一次版本读取；两个业务投影器独立决定领域成员并共用基础工具。API／Store 返回同一快照的两图，图不持久化为第二份业务数据。视频输入元数据校验由图与真实执行共用，执行门禁仍逐次运行。

前端共同容器不依赖场次 DTO；业务渲染与编辑在各自适配器中。导演旧缓存迁移留在 directorLayoutAdapter，单元使用自己的几何排列。正常／精确入口及定位使用后端成员与目标；技术几何缓存不构成新的业务范围。指令与剪辑 graph 没有迁移；四画布仅共享现有保存机制的修正。

没有新增草稿实体、第二套保存接口、逐次历史账本、跨镜头生成、批量生成、通用动态表单或自动采用。六岗职责、镜头计划与 Take、参考要求与真实绑定、范围与准备／检查／审查／采用分别表达。维护接入步骤见 `site/content/docs/guide/canvas-graph.md`。

## 最终审查

首次固定基线的 Standards／Spec 两轴审查已完成：规范 2 项、规格 2 项，待修复与复查。根视图不透明地址、未保存导演对象重进和新单元首次保存前参考绑定仍需补验，见 review.md。票据勾选与计划结项应在审查完成后进行。
