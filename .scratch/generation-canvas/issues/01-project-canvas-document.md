# 01: 项目画布与文本内容的创建、保存、重开

Status: ready-for-agent
Blocked by: None

**What to build:** 用户从项目进入画布生成，创建并命名多张画布，编辑文本内容卡、手动保存并重开，获得真实的版本冲突及幂等保护。

**依据：** [实现规格](../spec.md)；[任务依赖与共同验证](../README.md)。验收覆盖：A01、A02、A30。

## Acceptance criteria

- [x] 项目级入口、列表、创建、读取、命名和无活动内容的删除形成真实 HTTP／数据库／页面链路，不要求章节或场次；沿用项目归属与权限。
- [x] 建立 CanvasDocument、类型版本和文本内容卡的最小持久契约；卡片有不可变身份，一张文本卡一份内容，空卡可保存。
- [x] 手动保存提交完整 document、request_id、expected_revision；CAS 冲突返回 REVISION_CONFLICT，不覆盖服务端内容。
- [x] 保存效果与回执原子持久化；原请求重放返回原回执，同 ID 不同内容返回 IDEMPOTENCY_CONFLICT；后来的 revision 不改变历史回执。
- [x] 文档编辑与运行记录／当前输出分开，位置、尺寸、视角不纳入内容 revision；不引入草稿、发布或场次版本实体。
- [x] 类型和结构错误给出 code、target、blocks；坏身份、损坏结构阻止保存，空内容允许保存。
- [x] 首个消费者实际使用轻量类型定义与 rendererRegistry，不先建未使用的插件／通用表单框架；普通 HTTP 通过 generated client。

## Validation

- HTTP 验证两画布隔离、项目归属、保存回读及回执持久化。
- 隔离 MySQL 多连接验证并发 CAS 与同请求竞争；无环境时列出限制，不用 SQLite 宣称竞争已验收。
- 浏览器完成新建→编辑→保存→切换→刷新，验证内容及 revision，而非只看成功提示。
- 执行 [共同检查要求](../README.md#共同检查要求) 中适用于本票变更的命令，并记录真实结果。

## Scope and handoff

向后续票提供文档读写、稳定卡片身份、类型注册最小边界及保存回执。自动保存与恢复由 02 完成；媒体、连线与运行分别在后续票扩充，未接通入口不能伪装可执行。

## Comments

- 2026-10-23：依据已确认术语和 ADR 建立实现票据，尚未开始实现或执行验收。


- 2026-10-23 implementation_complete：项目级列表／创建／命名／删除／重开与文本卡页面已接真实 API 和 generated client；独立文档、类型版本、稳定卡片 ID、CAS 与持久幂等回执已实现。迁移 `d6a0b4c8e957`；当前生效边界见 `site/content/docs/architecture/generation-canvas.md`。保留 triage Status，不把 ready-for-agent 伪作完成枚举。
- TDD：首个 HTTP 用例先因模块不存在失败，再通过；非对象 document 用例先复现 FastAPI 原始 422 缺少诊断，再将文档结构校验收敛到带定位的领域诊断后通过。HTTP 每请求使用真实数据库事务，无内部协作者 mock。
- 后端最终验证（backend）：`JELLYFISH_TEST_MYSQL_URL=<显式隔离测试库> UV_CACHE_DIR=/tmp/jellyfish-uv-cache UV_PROJECT_ENVIRONMENT=/Users/extreme/Projects/github.com/jellyfish/backend/.venv uv run pytest tests/test_generation_canvas_api.py tests/services/test_task_mysql.py -q`：13 passed（1 条既有 Alembic path_separator 弃用警告）。MySQL 8.0.39 隔离容器的 `jellyfish_check_generation_canvas` 完整迁移到 head；真实多连接 HTTP 同 revision 仅一份生效、同请求并发返回相同回执、同 ID 不同正文竞争拒绝；迁移／模型比较含两张画布表。SQLite 功能验证不用于宣称并发正确。
- 前端最终验证：根目录 `pnpm --dir front run typecheck` 通过；`PATH=/Users/extreme/.nvm/versions/node/v22.21.1/bin:$PATH PLAYWRIGHT_CHANNEL=chrome UV_PROJECT_ENVIRONMENT=/Users/extreme/Projects/github.com/jellyfish/backend/.venv UV_CACHE_DIR=/tmp/jellyfish-uv-cache node front/tests/run-browser.mjs generation-canvas` 通过 preflight 与 generation-canvas（5.6 秒）。真实页面新建→编辑→手动保存→第二张空文本卡→切换→刷新，核实 HTTP 落盘正文、名称及 revision=1；证据保存在 `/private/tmp/jellyfish-generation-canvas-evidence/01/browser-JeUgdd/`（含 screenshot、results.json 和日志）。初次运行修正测试夹具的非法项目 style 及 Ant Select 的键盘交互／新文档加载等待。
- 契约已从本工作树 app.openapi 导出并运行 `pnpm --dir front run openapi:gen`，只保留有语义变化的生成内容。由于 8000 是用户既有服务，未停止或替换它；集成分支合入后由主代理核实该服务载入当前代码，再执行规定的 `pnpm --dir front run openapi:update`。这是剩余的集成检查，不宣称临时导出等价于已完成指定命令。
- 本票无付费模型调用。自动保存、恢复／冲突交互与独立布局由 02 接续；媒体、图结构及活动运行删除保护按后续依赖票接续。HTTP 命令封套自身（如 request_id／expected_revision）的基本错误仍沿用 FastAPI 422；文档结构／类型／身份错误与 CAS 冲突使用 CanvasError 诊断契约。
- 后端最终全量静态检查：`UV_CACHE_DIR=/tmp/jellyfish-uv-cache UV_PROJECT_ENVIRONMENT=/Users/extreme/Projects/github.com/jellyfish/backend/.venv uv run pylint app`：10.00/10，无诊断。`git diff --check` 通过。
- 截图证据补充：同一 generation-canvas 用例再次通过（6.4 秒），截图使用 `animations: disabled` 完成现有页面 fadeIn 动画，避免刷新后短暂半透明画面；稳定证据 `/private/tmp/jellyfish-generation-canvas-evidence/01/browser-tyL67W/`。
