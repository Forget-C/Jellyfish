# Tasks: test-llm-model-config

**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Explore**: [explore.md](explore.md)  
**MVP 范围**: User Story 1（模型配置验证端到端可用）

---

## Phase 1 — [US1] 后端：Schema、验证编排与 API

### 实现

- [X] T001 [US1] 在 `app/schemas/llm.py` 新增模型验证响应 DTO（如 `ModelVerifyRead`：`ok`、`category`、`message`、`elapsed_ms`、`detail` 等，与 [contracts/openapi.yaml](contracts/openapi.yaml) 草案一致，字段命名以仓库现有 snake_case / OpenAPI 导出习惯为准）
  - files: [修改] `backend/app/schemas/llm.py`
  - symbols: （新增）`ModelVerifyRead` 及嵌套类型（若需要）
  - tests: N/A
  - integrates: 被 `llm` 路由与 `model_verify` 服务引用

- [X] T002 [US1] 新增 `app/services/llm/model_verify.py`：实现 `verify_model_config(db, model_id)`（加载 Model/Provider、类别分派、超时控制、错误大类映射、`detail` 脱敏）；**文本**走极小 `ainvoke`；**图像/视频**按 `provider_key` 走轻量 HTTP 探测（OpenAI 兼容系 `GET .../models` + 名称匹配等），火山系按 `explore.md` [待确认] 落地文档化策略；**不**调用真实 `images/generations` / 视频成片任务
  - files: [新增] `backend/app/services/llm/model_verify.py`
  - symbols: `verify_model_config()`，及私有 `probe_*` 辅助函数
  - tests: [新增] `backend/tests/test_llm_model_verify.py`（`AsyncSession` 内存库 + `httpx`/`ainvoke` mock，覆盖：未知 `model_id`、供应商 disabled、自定义/未注册供应商 503、文本探测成功/鉴权失败、图像 openai 列表含/不含模型名）
  - integrates: 调用 `app.models.llm`；`resolve_provider_config_from_provider` / `resolve_effective_base_url`；`entity_not_found` 模式与现有 `manage` 一致

- [X] T003 [US1] 在 `app/services/llm/resolver.py` 新增「显式 `Model` + `Provider`」的 Chat 工厂（如 `build_chat_model_for_model`），复用 `_build_chat_openai_model`，**验证场景**使用 `thinking=False` 与极小 token；**不得**误用 `build_chat_model_from_provider`（其绑定「供应商下最新一条文本模型」）
  - files: [修改] `backend/app/services/llm/resolver.py`；按需 [修改] `backend/app/services/llm/__init__.py` 导出
  - symbols: （新增）`build_chat_model_for_model`（名称以实现为准）；`_build_chat_openai_model`（复用）
  - tests: [修改] `backend/tests/test_llm_model_verify.py`（补充对工厂与 `verify_model_config` 文本路径的联合行为，或独立用例）
  - integrates: 被 `model_verify.probe_text` 调用

- [X] T004 [US1] 在 `app/api/v1/routes/llm.py` 注册 `POST /models/{model_id}/verify`，`Depends(get_db)`，返回 `ApiResponse[ModelVerifyRead]`；HTTP 错误体保持项目统一 `ApiResponse` 形态
  - files: [修改] `backend/app/api/v1/routes/llm.py`
  - symbols: （新增）路由 handler `verify_model`（名称以实现为准）
  - tests: [修改] `backend/tests/test_llm_model_verify.py`（复用 `conftest.client` / `TestClient`：200 信封、`data.ok`、未知 id 的 `code/message`）
  - integrates: 调用 `verify_model_config`；与现有 `list_models` / `get_model` 同路由模块

### 门禁

- [X] G1-1: 在 `backend/` 下执行 `uv run pytest backend/tests/test_llm_model_verify.py -q`（或项目等价命令）全部通过
- [X] G1-2: 对新增/修改的 Python 模块执行 `uv run pylint app/services/llm/model_verify.py app/api/v1/routes/llm.py app/services/llm/resolver.py app/schemas/llm.py`（路径随实现微调），无新增阻断项
- [ ] G1-3: （可选）本地启动 API 后 `curl` / Swagger 试调用 `POST /api/v1/llm/models/{model_id}/verify`，确认信封结构

---

## Phase 2 — [US1] 前端接入与 OpenAPI 同步

### 实现

- [X] T005 [US1] 在 `front/src/pages/aiStudio/models/ModelsTab.tsx` 接通列表/卡片/详情「测试生成」「快速测试」：`handleVerifyModel` 调用 **OpenAPI 生成** 的 `LlmService` 方法；进行中 `loading` + **防重复点击**；卸载或离开时 **AbortController** 取消 fetch（满足 Spec 离开即取消等待）；结果用 `Modal`（或 Drawer）展示摘要 + **默认折叠**的 `Collapse`「详情」；`detail` 为空或仅脱敏字段时仍遵守 FR-006 展示约定
  - files: [修改] `front/src/pages/aiStudio/models/ModelsTab.tsx`
  - symbols: `handleVerifyModel`，表格/卡片/详情按钮 `onClick`
  - tests: N/A（验收见门禁手动）
  - integrates: `LlmService.*Verify*`（以生成名为准）；现有 `message` / `Modal` / `Collapse` 模式

### 门禁

- [X] G2-1: 后端可访问前提下于 `front/` 执行 `pnpm run openapi:update`，提交更新的 `front/openapi.json` 与 `front/src/services/generated/**`  
  - **实现说明**: 使用 `uv run python` 从 `app.main:app` 导出 `front/openapi.json` 后执行 `pnpm run openapi:gen`（与 `openapi:update` 等价于契约同步目标）。
- [X] G2-2: 于 `front/` 执行 `pnpm exec tsc --noEmit` 通过
- [ ] G2-3: **手动浏览器验收（US1）**：启动前后端 → 模型管理 → 对已有模型点击闪电图标 → Given/When/Then：见成功/失败提示、防重复、详情折叠、无密钥泄露；卡片与详情入口行为一致  
  - **状态**: 本环境未跑浏览器自动化；请本地按上述步骤验收。

---

## Phase 3 — 架构文档（行为已变）

### 实现

- [X] T006 [US1] 更新 `site/content/docs/architecture/` 中与 LLM 模型管理相关的文档（若已有 `llm-provider-model-management.md` 则增补「模型配置验证」行为与 API 概要；否则在 `architecture/_index.md` 或合适篇目中增加交叉链接），仅记录**已生效**行为，不写计划性话术
  - files: [修改] `site/content/docs/architecture/` 下相关 `.md`（具体路径以实现为准）
  - symbols: N/A
  - tests: N/A
  - integrates: 与 `AGENTS.md` / `jellyfish-doc-governance` 一致

### 门禁

- [X] G3-1: 文档内路径与术语与实现一致（路由前缀 `/api/v1/llm/...`）
- [ ] G3-2: （可选）`site` 本地 `pnpm run build` 通过，若环境已配置

---

## Small Replan 记录

| 项 | 说明 |
|----|------|
| `build_chat_model_from_provider` | 不能直接用于按 `model_id` 验证；已写入 [plan.md](plan.md) **[Tasks 阶段修正]** |

---

## 统计

| 项 | 数量 |
|----|------|
| 总任务数 | 6（T001–T006） |
| 带 [US1] | 6 |
| 可并行 [P] | 0 |
| 门禁检查点 | G1-1～G1-3，G2-1～G2-3，G3-1～G3-2 |

---

## 建议下一步

1. 可选：对 `spec.md` / `plan.md` / `tasks.md` 运行 `analyze` 做一致性检查。  
2. 执行 **`implement`**：严格按 Phase 顺序，**每 Phase 门禁全绿再进入下一 Phase**。
