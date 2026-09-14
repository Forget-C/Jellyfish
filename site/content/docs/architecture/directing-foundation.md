---
title: "场次工作台核心数据与版本"
description: "阶段一已实现的六部门契约、场次归属、版本存储、Take 和剪辑引用约束。"
weight: 32
---

2026-09-14：场次工作台 P1（T01–T02）已落地到后端契约、领域服务和 Alembic 迁移。当前交付为 **M0 数据基础**，尚无场次 HTTP API、页面、提示词编译器或视频提交入口。现有分镜产品流程仍在运行；后续工作见[实施任务](/docs/plans/directing-workbench-implementation-tasks/)。

## 身份与存储

所有新增跨层契约在 `backend/app/core/contracts/directing/`，存储模型在 `backend/app/models/directing.py`，业务读写入口为 `backend/app/services/directing/store.py` 的 `DirectingStore`。

| 对象 | 当前存储 | 身份与约束 |
| --- | --- | --- |
| Sequence | `directing_sequences` | 属于 Chapter，通过章节确定 Project；章节内 position 唯一；与场所资产 Scene 不同 |
| SceneDesignRevision | `directing_revisions`，kind=design | 六岗共享一份设计内容；镜头、节拍、事件、调度和空间锚点使用版本内稳定 ID |
| ProductionPlanRevision | 同表，kind=plan | 引用同场次已确认设计；GenerationUnit 嵌入计划，身份为 plan_revision_id + unit_id |
| PromptRevision | 同表，kind=prompt | 绑定计划版本与单元；正文、格式版本、编译说明和来源同存 |
| ReviewPacketRevision | 同表，kind=review | 固定提示词、单元、镜头出现项及六岗检查行 |
| SequenceCutRevision | 同表，kind=cut | typed planned/media 项；单主视频轨可留空白但不能重叠 |
| Take | `directing_takes` | 固定 Prompt、计划、单元、TaskOutput、文件；审片注释单独 CAS 更新 |
| 版本依赖索引 | `directing_revision_dependencies` | 从类型化内容派生的直接依赖，不是第二份可编辑真值 |
| 剪辑素材索引 | `directing_cut_take_references` | 从 media 项派生，外键保护被采用的 Take |

设计、计划、提示词、审稿和剪辑共用一张版本表以减少重复版本实现，正文按 kind 用不同 Pydantic 契约校验。GenerationUnit、工作单行、审稿行和剪辑项不单独建表。单元 ID、局部 ID 的同版关联由领域服务校验；数据库保护场次、版本、任务输出、文件和引用索引关系。

`read_revision` 返回带项目/章节/场次的强类型版本快照；`read_take` 返回 TakeSnapshot。内部写入不向 API 暴露 ORM 原始 JSON。调用者必须使用领域服务完成内容和关联校验，不能直接修改 ORM payload 绕过业务约束。

## 六部门字段归属与消费

| 契约路径 | 当前保存/校验内容 | 当前使用与后续消费位置 |
| --- | --- | --- |
| `sources`、`Note` | 人工、原文、模型、文件、版本来源；未填、未知、不适用、明确无、事实、提议 | 服务核对来源和文件引用；快照读取；T04 展示确认、T06 编译溯源 |
| `participants/events/criteria` | 场内人物/物件身份、刺激事件、可观察验收要求 | 各岗共同 ID 校验；角色/物件核对项目关系；T04 工作单和 T06 审稿 |
| `direction` | 视点、信息/关系变化、转折、不可改事实、节拍目标/阻碍/变化、空间锚点/轴线/尺度、人物位置/朝向/主动权/路径、镜头职责与覆盖 | 生产计划引用镜头/节拍/事件；编译路径解析；T04 设计、T12 预演 |
| `performance` | 角色情境；人物收到的事件、目标、阻碍、潜台词、注意对象、内在调整、身体动作、对白/表达、反应先后、出拍状态、避免项、眼神/呼吸/重心/手/声通道 | 共享 beat/participant/dialogue/criterion 校验；拆镜仍复用原表演谱；T06 动作编译、T08 审片 |
| `staging` | 景深、持续任务、路径、注意对象、触发/延迟、强度、入出画、叙事作用、终态、环境活动与留白理由 | 人物/空间/事件关联校验；T06 背景活动编译与审查 |
| `cinematography` | 构图/层次/视点、机位/高度角度、焦段效果/景深焦点、支撑、运动起止/触发/路径/速度、光源/明暗/曝光色温、光学效果/运动质感、技术意图、衔接与禁止项 | 按计划镜头关联，不复制为旧 ShotDetail；T06 图片/视频编译、T08 摄影审查 |
| `continuity` | 空间、造型、手部道具、环境、机位、对白声音六类前态/变化/后态/后续约束 | 事件/人物校验；计划状态独立于素材观察；T14 接缝检查、T15 台账 |
| `sound` | 对白身份/版本/人物、声源、环境动作声、音乐约束、生成/后期/未知执行方式 | 表演对白引用校验；T06 编译及能力缺口，不表示已经完成音频 |
| `prompt` | 编译优先级、绑定要求、声音策略、禁止项 | 冻结设计中保存；T06 正式编译；最终文本存在独立 PromptRevision |
| `Prompt.decisions` | 设计 JSON pointer、原文片段/参考/等效表达/未表达及解释 | 当前检查设计路径、真实文本片段及单元素材 ID；T06 展示与正式批准检查 |
| `ReviewPacket` | 岗位 × 出现项记录、理由、问题/影响字段/建议/验收 | 当前校验完整清单与版本一致性；T06 执行审稿、裁决和授权 |
| `TakeAnnotation`、`SequenceCut` | 实际覆盖与证据、过/保/修/废、保留区间、显式采用源区间 | 当前可读写、校验及保护文件；T08 播放/选片/粗剪 |

字段可保存、读取和关联验证不意味着编译/审片产品已接通。P1 不实现风格规则管理、返工单、经验候选、台账页面及自动观察；这些仍按 T11、T14–T16 推进。`style_revision_id` 已留有契约归属，但当前非空写入明确报错，不假装风格版本已存在。

## 状态、版本和事务

- 草稿新建时 `version=1`。更新必须携带 expected_version，通过 SQL 条件更新递增版本；旧版本写入报 RevisionConflict。
- `confirm_revision` 由上层已鉴权的人工作用域提供 actor_id，服务写入确认人与时间并递增版本。模型输入契约没有确认字段。
- 确认后禁止原地更新。修改以新 ID、parent_id 派生草稿，原版本和旧 Take 保持可追溯。
- 生产计划、提示词、审稿及预演引用同场次的已确认依据。不能把其他项目、其他场次、其他类型或未确认版本拼入当前对象。
- 确认在 P1 只表示文档冻结，不代表模型能力通过、审稿通过或用户已经授权视频执行。编译/执行授权事件和正式提交前检查属于 T06–T07。
- `DirectingStore` 不 commit 外层事务。每次修改使用 savepoint，使正文、依赖索引和文件使用保护原子更新；失败不留下部分关系。
- 场次创建记录章节原文 SHA-256；章节来源必须匹配该场次保存的来源版本。原文变更后的场次调整及界面提示属于 T03–T04，P1 不重写旧设计来源。
- 暂无业务删除接口。外键限制直接删除仍有引用的章节、场次、版本、TaskOutput 和 Take；不会自动清理已有开发数据。

## 生成单元、素材与剪辑

单元覆盖项保存局部 ID、镜头、节拍、事件和明确动作范围。一镜可出现在多个单元，同一单元可产生多个 Take。计划支持多镜范围，不代表当前任何生成供应商已经验证多镜能力。

ModelCapability 默认 unknown；明确 supported/unsupported 或参考媒体能力需附来源。未知/不支持的方案仍可作为创作计划保存，P1 不提供提交入口。实际执行前的能力验证、显式拆单元在 T05–T07 完成。

参考素材固定 file_id、用途、主体及顺序，服务检查媒体类型与可用性。新增 `directing_reference`、`directing_take` 两类 FileUsage；现有 API 的 usage_kind 是字符串，公共 OpenAPI 结构未改变。冻结设计、参考包、来源证据、Take 和剪辑都复用现有文件可用性检查与删除保护。

Take 只登记已成功、项目匹配、input_snapshot.prompt_revision_id 匹配的 TaskOutput，唯一键为 `(task_id, output_ordinal)`。MySQL 锁定输出行后检查幂等身份。重复登记返回原 Take；明确再次试拍对应另一任务。P1 尚未将现有 Publisher 接到该服务，T07 负责真实任务交付衔接。

实际覆盖必须指向该 Take 文件并有相同的证据区间；音视频实际时间码需满足 `0 <= in < out <= duration_ms`。未知文件时长不能用于实际剪辑。审查状态与四类结论匹配，结论与采用独立。

planned 项使用预计时长与设计镜头；media 项使用 Take 和实际 source_in/source_out 毫秒区间。Pydantic 判别联合拒绝混填。登记或审查 Take 不自动增加、替换任何剪辑项。

## 迁移与验证

新增迁移 `24c8e1a6b902_add_directing_foundation.py`，前驱为 `13b6a9d2e401`。只新增五张场次基础表，不转换旧镜头、任务历史或资产，不更新现有开发数据库。

已在临时 MySQL 9.0.1 独立容器的空库执行完整 Alembic 升级链，并验证实际表结构、并发 CAS、并发 Take 幂等、快照读取和局部粗剪保存。SQLite 隔离测试启用外键，验证新迁移、约束及带数据的后继列变更；已有早期迁移含 SQLite 不支持的 ALTER，不据此声称整个历史升级链支持 SQLite。

离线回归：

```sh
cd backend
.venv/bin/python -m pytest tests/directing tests/services/studio/test_files_delete.py tests/services/generation/publishers/test_publishers.py tests/services/test_task_files.py tests/test_task_schema_migration.py -q -m 'not integration'
```

MySQL 并发测试需新建且已迁移至 head 的独立空业务库，名称必须以 `jellyfish_check_directing` 开头；使用 `JELLYFISH_DIRECTING_MYSQL_URL` 显式指定后运行 `tests/directing/test_mysql.py`。测试不调用模型或对象存储；它只证明数据基础成立。
