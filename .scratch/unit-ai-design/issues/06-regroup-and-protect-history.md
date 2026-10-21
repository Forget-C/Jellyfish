# 06: 整份方案重组、移除与历史保护

Status: ready-for-agent
Blocked by: 04
Resolution: completed

**What to build:** 用户可把已有单元方案拆分、合并或从三个调整为两个，在同一次预览中处理引用阻塞和历史影响，确认后整体生效且历史记录保持原样。

来源规格：[单元画布 AI 设计与生产单元组织](../spec.md)。

## 前端要求

- 完整展示新增、修改和移除差异，拆分与合并的新单元清楚可辨，仍使用统一“AI设计”入口和一次确认。
- 移除被设计 occurrence 或实际覆盖标注引用的单元/覆盖项时，展示具体阻塞位置与导航，阻止确认，不能强制覆盖。
- 对仅有历史记录或运行中任务的移除项，预先说明历史保留、运行任务继续与原依据重试不可用。
- 处理引用后按当前输入重新核对；若结果已过期，保留结果供查看并要求重新设计，不因处理了阻塞就跳过过期校验。

## 后端要求

- 基于 04 的既有方案与稳定身份处理，支持整份单元集合重组；拆分、合并产物用新身份，原单元明确保留或移除。
- 查询并返回当前设计引用和真实覆盖标注阻塞，保护单元及覆盖项身份，不自动迁移、删除或改写关联事实。
- 历史任务、Take 和检查记录本身不阻止移除，继续保留原版本、原单元与固定依据；不得改绑到新单元或清除媒体。
- 运行中的任务按冻结输入继续，完成后仍按原任务登记候选，即使原单元已从当前方案移除。
- 原单元移除后，按原依据重试不可用；历史仍可读取，不自动建替代单元恢复重试。
- 继续保护历史计划、真实落幅依赖、既有采用、时间线及跨镜头单元；任何越界、引用阻塞、失效或保存冲突使整份应用失败。

## 验收标准

- [x] 浏览器演示三单元变两单元、单元拆分与合并，完整差异显示后一次确认保存；新的工作有新身份。
- [x] 分别构造设计 occurrence 与实际覆盖标注引用，预览返回准确位置，前端可定位且不能确认，关联事实与单元均未被部分改写。
- [x] 仅有历史任务、素材与检查时允许移除；历史读取一致，媒体、采用和时间线不变，原依据重试拒绝。
- [x] 在任务运行时移除原单元，任务继续并正常登记原任务候选，不取消、不重定向、不自动采用。
- [x] 一份方案混合合法变更与阻塞/越界项，验证整体不写入；包含目标及其他镜头的既有单元不被误删。
- [x] 处理引用后相关内容已变时旧结果拒绝；保存仍保留独立其他镜头的新编辑。
- [x] 真实后端生命周期和浏览器验收在本票完成，不能将历史保护留为后续测试补丁。

## 验证与完成要求

- 使用已确认的真实 HTTP、数据库与任务生命周期测试，以及现有浏览器流程；仅替换外部模型响应。
- 遵循 TDD：逐条验证行为，先看到相关用例失败，再实现并确认通过。复用既有单元范围投影测试入口。
- 前端改动执行项目 typecheck；Python 应用改动执行相关测试及全应用 Pylint；对外契约变化同步 OpenAPI 与 generated client。
- 验证范围与本票变化匹配；完成时记录实际命令、结果和限制，并勾选已通过的验收项。

## 范围与依赖说明

依赖 04 的既有单元差异与身份保留机制，不依赖 05 的补拍入口语义。移除与引用/历史保护必须作为一个闭环交付。

规格编号：FE-08、FE-09、FE-10、FE-11、BE-05、BE-07、BE-08、BE-09、HP-01、HP-02、HP-03、HP-04、HP-05、HP-06、HP-07、HP-08、HP-09、HP-10、FA-06、FA-09、FA-10、FA-11、BA-08、BA-09、BA-12、BA-13、BA-15、BA-16、BA-17、BA-18、BA-20。

## Comments

- 2026-10-21：用户调用 implement-spec，按已提出的六张任务及依赖进入实施。


- 2026-10-21 实施完成：整份方案支持明确移除与新身份拆并；结构化阻塞包含 subject／Take 稳定身份及当前路径，设计导航直接显示适用范围，未采用 Take 可定位实际覆盖。`unit_design_task_id` 记录最近明确应用来源，纯移除保存同样重验，保留独立及跨镜头单元。历史任务、检查、媒体与非空已采用时间线保持，运行中移除经真实 AI 应用、保存、任务完成与候选登记验证；新重试拒绝，旧授权仍幂等核实。
- 验证：`UV_CACHE_DIR=/tmp/jellyfish-uv-cache uv run --directory backend pytest tests/directing/test_scene_versions.py tests/directing/test_scene_copy.py tests/directing/test_scene_instructions.py tests/directing/test_unit_scope_projection.py tests/directing/test_scene_unit_design.py tests/directing/test_scene_unit_supplement.py tests/directing/test_scene_video.py tests/directing/test_scene_take_judgments.py -q --tb=short`：60 passed，无 skip；另已验证新增非空采用保护的视频生命周期 7 passed。
- 验证：`pnpm --dir front run typecheck` 通过；`UV_CACHE_DIR=/tmp/jellyfish-uv-cache PYLINTHOME=/tmp/jellyfish-pylint-cache uv run --directory backend pylint app`：10.00/10。
- 浏览器：`PATH=/Users/extreme/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH PLAYWRIGHT_CHANNEL=chrome node front/tests/sceneUnitRegroup.browser.mjs` 通过。真实隔离 HTTP／SQLite／TaskService，模型响应受控，验证三变二、拆分、合并一次确认保存刷新、两类引用及可执行导航、解除关联后过期、预览临时网络失败只重核实原结果、当前选择变化不改写旧任务冻结来源。桌面 1440×960、窄屏 390×844，截图已目视；最终证据目录 `/private/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-unit-regroup-9rvfox`。专用 8246／4246 服务随脚本结束关闭。
- 契约同步：从本工作树 `app.openapi()` 导出 schema 并运行 `pnpm --dir front run openapi:gen`；正式主工作树 `openapi:update` 与全套 workbench-ui 按集成约定由根代理统一执行。本票未声明 MySQL 验证。

- 2026-10-21：本票已合入 `codex-unit-ai-design`；正式 OpenAPI 同步、最终集成回归和两轴审查修复记录统一见[集成验收](../validation.md)。此前委托主集成执行的检查以该记录为准。
