# 来源引用与验收采用：集成验收

基线：`161b4933489af1b7b492b033ced09a77f1904a6a`。规格 SHA-256 保持 `cf402f9e32accaea004b718359cd5301899cf3a22f2c9d3f150c71243f559e27`。

## 用户故事与行为证据

| 用户故事 | 行为 | 证据 |
| --- | --- | --- |
| 1–8 | 原字段纯文本／完整引用、身份稳定、明确依赖及媒体边界 | 验收、表演、空间、画面、声音公开接口及 carried-images/video、design-references 浏览器回归 |
| 9–16 | 验收方向、直接采用、随设计采用、未采用不传播、无结果复核及无环 | guidance 公开接口、实际工作器及 guidance／design-relations 浏览器 |
| 17–23 | 多设计、直接＋间接和菱形去重、不同身份不合并、逐路径解除 | adoption-paths 公开接口及 multipath-protection 浏览器；保留正文重复引用 |
| 24–30 | 主体、speaker、关注／焦点、空间和叙事身份／顺序、画面定位、声音制作安排 | 各组 02–06 票据证据及本票25类混合文档公开接口回归 |
| 31–32 | 实际用途显示、空／加载／失败、本地示例与未生效状态 | candidate-states 浏览器 |
| 33–36 | 精确清理18类、保留其他用途、候选规范化、合法性、幂等 | 各组迁移公开接口及本票25类同文档＋7类保留对照、重读幂等和旧修订409 |
| 37–41 | 有效／停用引用、失效保留、受影响生成阻止、删除保护及批量删除 | adoption-paths 接口、multipath-protection 浏览器和现有删除回归 |
| 42–43 | 原子撤销重做、重开和恢复不复活旧用途 | 各组旧本地恢复场景、25类 design-metadata 全生命周期及 multipath-protection |
| 44–46 | 运行固定依据、旧冲突准入、已完成历史及已请求执行边界 | 18类旧快照实际工作器参数和现有运行／执行依据／历史测试；使用受控供应商替身 |
| 47 | 素材可用性、数量和模型用途／能力 | carried-images/video、设计媒体公开接口、现有能力预检测试 |
| 48 | 只读查看、禁用修改、浏览不保存 | candidate-states、guidance、各类设计浏览器的同上下文只读观察页 |

每项测试验证公开文档、编译结果、执行结果或用户可见交互；没有新增生产测试API。详细逐类证据保留在01–08票据Comments。

## 集成期间修正

- 全后端首次检查的18项旧断言仍要求effect_object存在或生效。目录改为校验退役，通用关系诊断改由仍合法的验收关联／主体／speaker／连续性关系覆盖，构图改为完整字段来源引用；保留断线、缺失身份、跨画布、重复绑定、非法用途及内容保留的原测试目的。
- carried-images浏览器仍要求唯一独立设计先手动采用，与现行连线即采用冲突；改为验证自动采用后携带媒体，保留来源定位和最后有效字段引用移除测试。首次失败日志保留供复核。
- 初次全后端另有3项无关文件URL用例因环境缺少S3桶名失败。使用占位 `S3_BUCKET_NAME=test-bucket` 后文件模块8项通过；不连接真实S3，不修改生产存储行为。
- 同步架构和工作台旧段落中关于effect_object与明确依赖不传播的陈述；局部发布函数注释明确其与模型依赖闭包的职责差异。

## 检查记录

- 首次全后端：1494 passed、47 skipped、21 failed（18旧用途期望、3测试环境配置）；日志 `/private/tmp/ref09-backend-full.log`。
- 相关旧断言迁移及新增25类混合文档公开接口：43 passed；日志 `/private/tmp/ref09-stale-tests.log`。
- 存储环境对照：8 passed；日志 `/private/tmp/ref09-storage-env.log`。
- 完整前端unit、typecheck、lint基线检查通过；lint 274项存量、0新增；应用Pylint 10.00/10。
- 标准OpenAPI更新已由根代理从当前主工作区自动重载后端执行：schema及生成客户端内容等价，461处纯EOF变化逐文件核对恢复。集成后无新公共契约变更。
- 最终统一全后端：`S3_BUCKET_NAME=test-bucket uv run pytest -q` → **1516 passed、47 skipped，331.18s**；日志 `/private/tmp/ref09-backend-final.log`。新增混合文档补充直接＋间接验收采用及来源去重后单项1 passed，日志 `/private/tmp/ref09-mixed-final.log`。
- canvas-design全部17项最终通过，结果来自连续的首轮及仅失败／未执行项续跑：`browser-1Nko4x`、`browser-5w5GCc`、`browser-1pE1oz`。结果、运行日志和桌面／窄屏截图副本在 `/private/tmp/jellyfish-ref09-evidence`。25类元信息生命周期183.8s通过；来源关系卡面及候选窄屏截图已检查。
- photography-card旧“仅关系配置”夹具从已退役effect_object换为保留focus_object，继续验证仅有关系时的卡面配置与只读行为；最终8.7s通过。

## 边界

47项跳过沿用既有测试标记，包含外部MySQL等环境依赖。真实供应商质量、付费生成和真实S3网络行为不属于受控替身验证结果。本功能不提供自动验收或通过／不通过结论。

## 最终审查与集成

- Standards 与 Spec 两轴独立人工审查均为0项未解决问题；审查者阅读代码与既有验证证据，未独立重跑业务测试。
- 提交标题检查发现两条本次内部合并提交使用默认标题，已仅修正其消息并保持完整提交拓扑、作者及日期；原集成HEAD保留在本地备份分支 `codex-canvas-reference-adoption-before-title-fix`。
- 修正前HEAD `d2c9c7d7594339e4a8c8ed8c9cf3bbc913d785c1` 与修正后HEAD `761bace4fa5833707b2ebca09cbc69d62a0c32b5` 的树均为 `5bedca35dc554f05407927866a427352b64950c9`，代码及已验证文件内容未变。
- `node scripts/check-commit-subject.mjs --range 161b4933..HEAD` 已通过（收尾记录提交前33条）；规格SHA保持不变，01–09票据均记录为 integrated。
- 本轮只修改提交元数据和完成记录，复用已通过的业务验证，不重复运行相同代码测试。
