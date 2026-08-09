# Jellyfish 架構分析（唯讀）

> 目標存放位置：`docs/architecture-analysis.md`（Jellyfish 專案根目錄下）
> 來源：`github.com/Forget-C/Jellyfish`（main，commit 3f244c0，release v0.3.2）
> 性質：純架構閱讀分析。**未修改任何程式、未安裝套件、未新增 API、未建立資料庫遷移、未開始實作。**
> 分析對象以 **backend** 為主（Python 49.7%），並涵蓋 frontend / docker。
>
> **狀態更新（2026-07-23）**：架構評估已被接受。CAS↔Jellyfish 的整合方向已定案為
> 一組**最終架構決策**（見文末「## Final Architecture Decisions」）。本次僅更新
> 架構文件以反映這些決策，**不修改任何原始碼**。受決策影響而更新的章節：Overview、
> Project/Chapter/Shot mapping、Recommended CAS Integration Point、Safe Extension Points、
> Target data flow、Risks and open decisions。
>
> **實作進度（Sprint 2 / 2.1）**：已在 `backend/app/crypto_animal_studio/` 建立
> **受限邊界模組**與 **EpisodePackage v1 契約**（含結構化 `CameraSpec`：shot_type/angle/movement，
> 以 CAS 本地枚舉對齊 Jellyfish `ShotDetail.camera_shot/angle/movement`），並提供 CAS 健康端點
> `GET /api/v1/crypto-animal-studio/health`。**尚未**做資料庫落地、匯入器、Celery、LLM 或前端。
> 契約細節見 `docs/crypto-animal-studio/episode-package-v1.md`。

---

## 0. 總覽

Jellyfish 是一個**端到端 AI 短劇（short drama）製作平台**，把「劇本輸入 → 拆鏡 →
實體/資產抽取 → 分鏡準備 → 影像/影片生成 → 匯出」整條產線收斂到單一 workspace。

- **Backend**：FastAPI + LangChain/LangGraph + SQLAlchemy(async)，`uv` 管理，Python 3.12。
- **Frontend**：React 18 + Vite + TypeScript + Antd + Zustand（pnpm），OpenAPI 產生 client。
- **基礎設施**：Docker Compose（MySQL 9 / Redis 7 / RustFS(S3) / backend / celery-worker / front）。
- **非同步**：Celery + Redis 任務中心（`GenerationTask` 為持久真相來源）。
- **AI 能力**：一組窄職責 LangChain Agent（拆鏡、抽取、一致性檢查、資訊分析…）。
- **授權**：Apache-2.0。

核心領域模型（**沒有 "Episode" 這個實體**，最接近的是 Chapter）：

```
Project ─┬─ Chapter ─── Shot ─── ShotDetail ─┬─ ShotDialogLine
         │                     │              └─ ShotFrameImage
         │                     ├─ ShotCharacterLink
         │                     ├─ ShotExtractedCandidate（角色/場景/道具/服裝候選）
         │                     └─ ShotExtractedDialogueCandidate（對白候選）
         ├─ Character ── Actor / Costume / (CharacterPropLink → Prop)
         └─ Project{Actor,Scene,Prop,Costume}Link（資產在 project/chapter/shot 層的掛載）
Scene / Prop / Costume / Actor 為「跨專案可重用」資產庫；Character 為「專案內」角色。
GenerationTask ── GenerationTaskLink ── FileItem ── FileUsage（檔案在業務鏈上的用途）
Provider ── Model ── ModelSettings（多供應商/模型與預設）
PromptTemplate（提示詞模板，分類 PromptCategory）
```

### CAS ↔ Jellyfish 對映（最終決策）

Jellyfish 本身**沒有 "Episode" 實體**。整合方向已定案如下（詳見文末 ADR 表）：

- **一個 CAS Episode ＝ 一個 Jellyfish Chapter。**
- **一個 Jellyfish Project ＝ 一個「系列 / 製作 / 季（series / production / season）」**，
  可包含**多個** CAS Chapter/Episode。
- CAS 會把它**已完成的 storyboard 直接映射**成 Jellyfish 的
  `Chapter → Shot → ShotDetail → ShotDialogLine` 以及 Character／資產連結；
  **不得**把已完成的 storyboard 再送回 `ScriptDividerAgent`
  （否則會破壞喜劇節拍 comedy beats、時間 timing、對白對位 dialogue alignment 與鏡頭結構）。
- `Chapter.raw_text` 仍保存**完整生成的劇集劇本**以利追溯（traceability），
  但 **Shots 一律由 EpisodePackage 建立**，而非由 raw_text 重新拆鏡。
- CAS 不得建立與 Jellyfish 平行重複的 Project／Episode／Shot／Asset／Media／Prompt／Task 系統；
  一律**重用** Jellyfish 既有系統。

---

## 1. Backend 架構

分層清楚（README 明訂「路由瘦身、邏輯下沉」）：

| 層 | 路徑 | 職責 |
|---|---|---|
| 入口 | `app/main.py` | FastAPI app、統一例外處理（全部包成 `ApiResponse`）、CORS、`lifespan` 啟動時 `bootstrap_all_registries()`、掛載 `/api/v1`、`/health`。 |
| 設定 | `app/config.py` | `pydantic-settings`，從 `.env`/環境變數載入；DB URL、Redis/Celery、CORS、S3。**無硬編碼密鑰**。 |
| 啟動註冊 | `app/bootstrap.py` | 依序註冊「供應商能力」→「任務執行器」（皆冪等）。 |
| 依賴注入 | `app/dependencies.py` | `get_db`（async session）、`get_llm`/`get_nothinking_llm`（由 DB 內 Provider/Model 動態建構 ChatOpenAI）。 |
| 核心 | `app/core/` | DB 引擎、Celery、S3 storage、task_manager（可插拔 store/strategy）、tasks（image/video 執行器 registry）、contracts、integrations（openai / volcengine）。 |
| 資料 | `app/models/` | SQLAlchemy ORM（27 張表）。 |
| Schema | `app/schemas/` | Pydantic 請求/回應 + `skills/`（AI 技能輸出結構）。 |
| 業務 | `app/services/` | `common` / `studio` / `film` / `llm` / `worker` / script_processing。 |
| AI | `app/chains/agents/` | LangChain Agent（PromptTemplate + 結構化輸出解析）。 |
| 路由 | `app/api/v1/routes/` | film / llm / studio / script_processing / health。 |
| Celery | `app/tasks/execute_task.py` | 統一 Celery 入口：只收 `task_id` → 依 `task_kind` 從 registry 找 executor 執行。 |

要點：
- **例外統一**：`main.py` 把 HTTPException/ValidationError/未捕捉例外全轉成 `{code,message,data:null}`。
- **同步/非同步雙軌**：FastAPI 用 async session（`core/db.py`）；Celery worker 用 sync session（`core/db_sync.py`），且 prefork 子進程會 `reset_db_runtime()` 重建 engine，避免事件迴圈綁定錯亂。
- **註冊表模式**：provider 能力與 task adapter 都走「bootstrap 冪等註冊 + registry 解析」，擴充友善。

---

## 2. Frontend 架構

- `front/`：React 18 + Vite 5 + TypeScript 5 + **Antd 5** + **Zustand**（狀態）+ react-router 6 + i18next（en-US / zh-CN）。
- 主要頁面在 `front/src/pages/aiStudio/`，子模組對齊後端領域：`project / chapter / shots / assets / agents / models / prompts / files / editor / components / hooks`。
- **型別/請求由後端 OpenAPI 產生**：`front/src/services/generated/`（`core/`、`models/`、`services/`）由 `openapi-typescript-codegen` 產出。
- 產生流程（`package.json` scripts）：
  - `openapi:fetch` → `curl http://127.0.0.1:8000/openapi.json -o front/openapi.json`
  - `openapi:gen` → 產生 `src/services/generated`
  - `openapi:update` → 兩者合一。
- 有 `mocks/`（msw）供前端獨立開發。

含義：**前端是後端契約的下游**。任何後端 API/schema 變更，前端只要重跑 `openapi:update` 即可同步型別——這對整合很關鍵（見 §16）。

---

## 3. Docker / 部署

`deploy/compose/docker-compose.yml` 定義 7 個 service：

| service | 說明 |
|---|---|
| `mysql` (9.0) | 主資料庫，帶 healthcheck，資料卷 `mysql_data`。 |
| `redis` (7) | Celery broker。 |
| `rustfs` | S3 相容物件儲存（素材檔案），暴露 9000/9001。 |
| `backend-init-db` | 一次性：`uv run python init_db.py` 建 27 張表。 |
| `mysql-init-sql` | 一次性：依序套用 `backend/sql/*.sql` 遷移。 |
| `backend` | `uvicorn app.main:app`，port 8000。 |
| `celery-worker` | `celery -A app.core.celery_app:celery_app worker`。 |
| `front` | Nginx 靜態站，port **7788**。 |

- Dockerfile：`deploy/docker/backend.Dockerfile`、`front.Dockerfile`、`nginx.conf`、entrypoint 產生 `env.js`。
- **本機開發可免 Docker**：後端預設 `DATABASE_URL=sqlite+aiosqlite:///./jellyfish.db`，首次存取自動建檔；Celery/Redis/S3 皆為選配（未配置時對應功能降級或 503）。

---

## 4. Database

- ORM 優先：`init_db.py` 匯入所有模型後 `Base.metadata.create_all()`（開發/首建）。
- **正式遷移走 `backend/sql/*.sql`**（依檔名排序套用）：
  `001-init-prompt-template` → `002-add-shot-extracted-candidates` →
  `003-normalize-shot-status-remove-generating` → `004-add-generation-task-cancel-fields` →
  `005-add-provider-category-base-urls` → `006-migrate-model-defaults-to-model-settings-and-drop-is-default` →
  `007-add-video-size-ratio-defaults-and-overrides` → `008-add-shot-action-beats`。
- 引擎抽象於 `settings.database_url`：SQLite（aiosqlite）/ MySQL（aiomysql）/ PostgreSQL（asyncpg）皆可。
- 共 **27 張業務表**（models `__init__` 匯出清單為準）。

**注意**：ORM `create_all` 與手寫 SQL 遷移**並存**。兩者需保持一致；新增欄位時「改 ORM 模型」與「補一支 `009-*.sql`」要同時做，否則 Docker（走 SQL）與本機（走 create_all）會漂移。

---

## 5. ORM（SQLAlchemy 2.0 async）

- Base：`app/core/db.py::Base`（DeclarativeBase）；`TimestampMixin`（created_at/updated_at）。
- 模型依類別拆檔，`app/models/studio.py` 聚合 re-export：
  - `studio_projects.py`：**Project、Chapter**、Project{Actor,Scene,Prop,Costume}Link。
  - `studio_shots.py`：**Shot、ShotDetail、ShotDialogLine、ShotFrameImage、ShotCharacterLink、ShotExtractedCandidate、ShotExtractedDialogueCandidate**。
  - `studio_assets.py`：**Scene、Prop、Costume、Actor、Character、CharacterPropLink**。
  - `studio_asset_images.py`：各資產的多視角圖（AssetViewAngle/QualityLevel）。
  - `studio_prompts_files_timeline.py`：**PromptTemplate、FileItem、TimelineClip**。
  - `studio_file_usages.py`：**FileUsage**（file × project/chapter/shot × usage_kind）。
  - `llm.py`：**Provider、Model、ModelSettings**（+ AgentTypeKey/ProviderStatus/ModelCategoryKey enum）。
  - `task.py`：**GenerationTask**；`task_links.py`：**GenerationTaskLink**。
- 列舉集中在 `models/types.py`（ProjectStyle、ProjectVisualStyle、ShotStatus、CameraShotType/Angle/Movement、DialogueLineMode、VFXType、PromptCategory、FileUsageKind…）。

關鍵欄位觀察：
- `Chapter.raw_text` / `condensed_text`：**劇本原文與模型精簡後版本**——這是拆鏡與抽取的輸入源。
- `Shot.script_excerpt` + `ShotDetail`（camera_shot/angle/movement、duration、mood_tags、vfx、`action_beats`、`first/last/key_frame_prompt`）。
- `Character` 為 **project 內**，關聯一個 `Actor`（視覺身份/選角）與可選 `Costume`。
- 資產（Scene/Prop/Costume/Actor）為**跨專案可重用庫**，透過 `Project*Link` 掛到 project/chapter/shot。

---

## 6. API

- 統一前綴 `/api/v1`，回應殼 `ApiResponse{code,message,data,meta}`（`schemas/common.py`：`success_response/created_response/empty_response/paginated_response`）。
- 路由聚合（`api/v1/__init__.py`）：`health`、`/film`、`/llm`、`/studio`、`script_processing`。
- Studio 子路由（`routes/studio/__init__.py`）：`projects、chapters、shots(+shot-details/dialog-lines/links/frame-images)、entities、prompts、files、timeline、image-tasks、shot-character-links`。
- Film 子路由：`generated_video、tasks_images、task_status`（另有 `film/extract/*` 影視技能）。
- `script_processing`：分鏡、實體/對白抽取、合併、變體分析、一致性檢查、劇本優化/精簡——**皆為 async 技能任務**（建立 task → Celery → 輪詢）。
- 錯誤語彙統一（`services/common/errors.py`）：`entity_not_found / entity_already_exists / required_field / invalid_choice / not_belong_to`。

---

## 7. Task Queue（任務佇列）

雙層設計：

1. **應用層 TaskManager**（`core/task_manager/`）：`store`（記憶體或 DB）+ `strategy`（`streaming` / `async_polling`）可插拔；`TaskStatus`（pending/running/streaming/succeeded/failed/cancelled）、`TaskRecord`/`TaskStatusView`/`TaskListItemView`（任務中心列表、可回跳 project/chapter/shot）。
2. **執行層 Celery**（`core/celery_app.py` + `app/tasks/execute_task.py`）：Celery 只收 `task_id`；`run_task_celery` 依 `GenerationTask.task_kind` 從 `services/worker/task_registry` 解析 executor 執行；支援 `revoke`（取消）。
- **執行器 registry**（`core/tasks/registry.py` + `bootstrap.py`）：以 `(task_kind, provider_key)` 為鍵註冊 factory；內建 `image_generation/video_generation × openai/volcengine` 四種。
- 持久真相是 **`GenerationTask`** 表（progress、result、error、cancel_*、executor_*）；`GenerationTaskLink` 把任務結果連回資源與 `FileItem`。

**擴充點**：新增一種任務＝加 `task_kind` + 實作 executor + `register_task_adapter` 註冊；不需改 Celery 入口。

---

## 8. Prompt 管理

兩套機制並存：

- **資料庫模板 `PromptTemplate`**：`category`（`PromptCategory`：frame_head/tail/key image/prompt、video_prompt、storyboard_prompt、各資產 front/other 圖、bgm/sfx…）、`content`、`variables`、`is_default`、`is_system`（系統預置僅初始化寫入、接口禁止刪改）。經 `routes/studio/prompts.py` 管理；`sql/001` 初始化。
- **程式內 Agent PromptTemplate**：各 Agent 於 `app/chains/agents/*` 內以 LangChain `PromptTemplate` 固化 system+task（例如 `ScriptDividerAgent` 的分鏡提示詞）。

前者是「使用者可調的生成模板」，後者是「AI 技能的內建流程提示詞」。

---

## 9. Asset（資產）管理

- 資產類型：**Scene / Prop / Costume / Actor**（跨專案庫）+ **Character**（專案內角色）。
- 每類資產有多視角圖（`*Image` 表，`AssetViewAngle` front/left/right/back/three_quarter/top/detail；`AssetQualityLevel` low→ultra）。
- 掛載關係：`Project{Actor,Scene,Prop,Costume}Link` 可綁在 project / chapter / shot 任一層 → 支援跨鏡頭重用與一致性。
- 一致性是「一等公民」：`ShotExtractedCandidate` 讓抽取到的資產先進候選、由人確認 `linked/ignored` 再落地；`consistency_checker_agent` 檢查漂移。
- 服務：`services/studio/entities.py`、`entity_crud.py`、`entity_images.py`、`entity_existence.py`（檢查重名鼓勵重用）、`shot_assets*.py`。
- 檔案：`FileItem`（type image/video、`storage_key` 指向 S3）+ `FileUsage`（用途歸屬）+ `core/storage.py`（boto3 + anyio 執行緒池，避免阻塞事件迴圈）。

---

## 10. Character 管理

- `Character`（`studio_assets.py`）：project 內，`name/description/style/visual_style`，關聯 `actor_id`（必填，視覺身份/選角）+ 可選 `costume_id`；關聯 `CharacterPropLink`（隨身道具）、`ShotCharacterLink`（鏡頭出演）、`CharacterImage`（角色圖）。
- 相關 Agent：`character_portrait_analysis_agent`（角色肖像分析）。
- 服務/路由：`shot_character_links`（鏡頭↔角色）、`entities`（CRUD）。
- 設計語意：**Character = 敘事角色**，**Actor = 可重用的視覺演員/選角**，兩者分離讓「同一演員演不同角色 / 同一角色換裝」成為可能。

---

## 11. Project / Shot /（Episode）關聯

- 層級：`Project → Chapter → Shot → ShotDetail(→ ShotDialogLine / ShotFrameImage)`。
- **Jellyfish 沒有 "Episode" 實體**。**最終對映（已定案）**：
  - **CAS Episode → Jellyfish Chapter**（章節帶 `raw_text`/`condensed_text` 劇本、`storyboard_count`、`status`）。
  - **Jellyfish Project → 系列 / 製作 / 季（series / production / season）**，一個 Project 可含多個 CAS Chapter/Episode。
  - CAS 的 storyboard **直接**建立 `Chapter / Shot / ShotDetail / ShotDialogLine / Character 與資產連結`；
    **不經過** `ScriptDividerAgent`（保護 comedy beats／timing／dialogue alignment／shot structure）。
  - `Chapter.raw_text` 保存**完整生成劇本**供追溯；但 **Shots 由 EpisodePackage 建立**，不由 raw_text 重新拆鏡。
- `Shot`：`chapter_id`、`index`（章節內唯一）、`title`、`script_excerpt`、`status`（pending/generating/ready）、`generated_video_file_id`。
- `ShotDetail`：鏡頭語意（景別/角度/運鏡/時長/情緒/VFX/action_beats）+ 三種 frame prompt（首/尾/關鍵幀）。CAS storyboard 的鏡頭資訊直接填入此表，跳過抽取候選流程。
- Shot 的準備狀態機（`services/studio/shot_preparation_state.py`、`shot_status.py`、`shot_video_readiness.py`）：抽取候選 → 確認/連結 → `ready` → 進生成 workspace。**CAS 匯入的 Shot 因已由 storyboard 直接建立，可設定 `skip_extraction` 直接進入 ready 判定**（不重跑抽取）。

---

## 12. Provider 架構

**兩條 provider 軸線，勿混淆：**

1. **文字/LLM provider（DB 驅動）**：`Provider`/`Model`/`ModelSettings` 存於 DB；`services/llm/resolver.py` 依 `ModelSettings` 的 `default_text/image/video_model_id` 解析出 Provider→建構 `ChatOpenAI`（`dependencies.get_llm`）。內建 provider spec（`provider_bootstrap.py`）：**openai（text/image/video）、volcengine（image/video）、aliyun_bailian（text）**，且各類別可有獨立 base_url（`sql/005`）。
2. **影像/影片生成 provider（契約驅動）**：`core/contracts/provider.py`（`ProviderKey = openai | volcengine`）+ `core/integrations/openai/*`、`volcengine/*`（images/video/capabilities/payload）+ task adapter registry（§7）。

要點：供應商 API Key 存 DB `Provider.api_key`（敏感欄位），非硬編碼；文字模型走 LangChain `ChatOpenAI`（OpenAI 相容）。

---

## 13. 生成流程（Generation Flow）

端到端（對照 README 與程式）：

```
劇本(Chapter.raw_text)
  → ScriptSimplifier/Optimizer（精簡/優化，可選）
  → ScriptDivider（拆鏡）→ 寫入 Shots（services/studio/script_division.py）
  → ElementExtractor（抽取角色/場景/道具/服裝 + 對白）→ ShotExtractedCandidate / DialogueCandidate
  → 人工確認/連結資產（entities、shot-character-links）→ Shot 準備狀態
  → EntityMerger / ConsistencyChecker / *InfoAnalysis（合併、去重、一致性、資產細節）
  → 建 frame prompt（shot_frame_prompt_agents / services/studio/generation/frame/*）
  → 影像生成任務（image_generation）→ ShotFrameImage / FileItem
  → 影片生成任務（video_generation）→ generated_video / FileItem
  → Timeline / 匯出
```

- AI 步驟多為**非同步任務**（建立 `GenerationTask` → Celery executor → 輪詢/連結）。
- 生成子系統模組化：`services/studio/generation/{asset_image,frame,video}/{build_base,build_context,build_submission,derive_preview}.py` — 每種生成都走「建基礎 → 建上下文 → 建提交 → 產預覽」四步，擴充一致。

### Target data flow（CAS，最終決策）

CAS 的產物是**已完成的 storyboard/EpisodePackage**，因此走一條**不同於原生拆鏡**的匯入路徑，
**刻意繞過 `ScriptDividerAgent` 與抽取候選流程**，以保護喜劇節拍與鏡頭結構：

```
Sample EpisodePackage（CAS 產出：episode + storyboard + dialogue + characters）
  → validation（schema 驗證，缺欄/格式錯即失敗，不靜默）
  → synchronous import service（第一里程碑：同步，不使用 Celery）
       ├─ 建/取 Project（= series/season；可含多集）
       ├─ 建 Chapter（raw_text = 完整生成劇本，供追溯）
       ├─ 由 storyboard 直接建 Shot / ShotDetail / ShotDialogLine
       ├─ 建立 Character 與資產連結（重用既有 entities / links）
       └─ （不經 ScriptDivider、不經 ElementExtractor 候選確認）
  → Chapter 與 Shots 在 Jellyfish（/docs、前端）可見 ✅（第一里程碑驗收點）
  →（後續里程碑）接回原生 frame/image/video 生成與 Timeline/匯出
```

第一里程碑刻意**同步且無 Celery**：`EpisodePackage → validation → 同步匯入 service → Chapter+Shots 可見`。
非同步任務化留待後續里程碑，屆時再沿用既有任務中心（不另建 CAS 任務系統）。

---

## 14. AI Agent 支援能力

`app/chains/agents/`，全部繼承 `AgentBase[T]`（`base.py`）：固化 `system_prompt` + `PromptTemplate` + `output_model`（Pydantic），呼叫 LLM 後有**非常強韌的 JSON 兜底解析**（剝 markdown、補未加引號的 key、修尾逗號、Python literal 兜底、`Foo(a=1)` kwargs 解析…）。

內建 Agent：
- `ScriptDividerAgent`（拆鏡）、`ScriptOptimizerAgent`、`ScriptSimplifierAgent`
- `ElementExtractorAgent`（角色/場景/道具/服裝/對白抽取）、`EntityMergerAgent`（實體合併）
- `ConsistencyCheckerAgent`（一致性）、`VariantAnalyzerAgent`（變體）
- `CharacterPortraitAnalysisAgent`、`SceneInfoAnalysisAgent`、`PropInfoAnalysisAgent`、`CostumeInfoAnalysisAgent`
- `ShotFramePromptAgents`（分鏡幀提示詞）

輸出結構定義於 `app/schemas/skills/*`（如 `ScriptDivisionResult`）。這是一套「窄職責、結構化輸出、可測試」的 agent 架構，與 LangGraph 相容（依賴含 `langgraph`）。

---

## 15. OpenAPI

- FastAPI 內建 `/openapi.json`、`/docs`（Swagger）、`/redoc`。
- **前端型別/請求由 OpenAPI 產生**（`front` 的 `openapi:update`）。因此 OpenAPI 是「後端↔前端」的正式契約：新增/改動路由或 Pydantic schema，前端重生成即可同步。
- 後端測試中有 `test_api_response_envelopes.py` 等，確保回應殼一致——OpenAPI 契約穩定性受測試保護。

---

## 16. 專案資料夾說明（Folder Guide）

```
Jellyfish/
├── backend/                     # FastAPI 後端（整合主要落點）
│   ├── app/
│   │   ├── main.py              # 入口、例外殼、CORS、lifespan
│   │   ├── config.py            # pydantic-settings（.env）
│   │   ├── bootstrap.py         # 啟動註冊（provider / task adapter）
│   │   ├── dependencies.py      # get_db / get_llm
│   │   ├── core/                # db、celery、storage、task_manager、tasks、contracts、integrations
│   │   ├── models/              # ORM（Project/Chapter/Shot/資產/task/llm）
│   │   ├── schemas/             # Pydantic 請求回應 + skills/（AI 輸出）
│   │   ├── services/            # common/studio/film/llm/worker + script_processing
│   │   ├── chains/agents/       # LangChain Agents
│   │   ├── api/v1/routes/       # film/llm/studio/script_processing/health
│   │   └── tasks/execute_task.py# Celery 統一入口
│   ├── sql/                     # DB 遷移（001–008）
│   ├── tests/                   # pytest（service/api/agent）
│   ├── init_db.py / init_storage.py
│   └── pyproject.toml（uv）
├── front/                       # React+Vite 前端；services/generated 由 OpenAPI 產生
├── deploy/                      # docker compose + Dockerfile + nginx
├── docs/                        # 專案文件（本檔目標位置）
├── site/                        # 專案網站
├── AGENTS.md / conftest.py / pytest.ini
```

---

## 17. 模組說明（Module Guide，速查）

| 模組 | 一句話 | 穩定性 |
|---|---|---|
| `core/db*`, `models/*`, `sql/*` | 資料真相與遷移 | 核心，改動需謹慎 + 補遷移 |
| `core/task_manager`, `core/tasks`, `tasks/execute_task` | 任務中心與 Celery | 核心，走 registry 擴充 |
| `core/integrations/{openai,volcengine}` | 生成供應商實作 | 以「新增資料夾」方式擴充 |
| `services/llm/*` | Provider/Model/預設解析 | 相對穩定；擴 provider 走 `provider_bootstrap` |
| `services/studio/*` | 專案/章節/鏡頭/資產/檔案主業務 | 活躍；整合多在此加 service |
| `services/script_processing*`, `chains/agents/*` | AI 技能與 agent | 擴充友善（新增 agent + schema + task_kind） |
| `api/v1/routes/*` | HTTP 介面（薄） | 新增子路由即可 |
| `schemas/*` | 契約（影響 OpenAPI/前端） | 只加不改，向後相容 |
| `front/services/generated` | 由 OpenAPI 自動產生 | **不要手改**，重生成 |

---

## 18. 哪些模組適合擴充（建議的 Extension Points）

1. **AI 技能層 `chains/agents/` + `schemas/skills/`**：新增 Agent（固定 system+template+output_model），最符合現有模式。
2. **任務種類 `task_kind` + `services/worker` / `core/tasks/registry`**：新增一種生成/處理任務，只需註冊 executor。
3. **Provider 能力 `services/llm/provider_bootstrap` + `core/integrations/<vendor>/`**：接新的文字/影像/影片供應商。
4. **Studio service `services/studio/*` + `api/v1/routes/studio/*`**：新增業務動作（薄路由 + 下沉邏輯 + `ApiResponse`）。
5. **Prompt 模板 `PromptTemplate`（DB）**：以資料方式擴充生成模板（`is_system` 保護預置）。
6. **生成四步 `services/studio/generation/*`**：沿 `build_base→context→submission→derive_preview` 擴新的生成型態。

擴充守則：路由薄、邏輯進 service、輸出用 `ApiResponse`、schema 只加不改、DB 改動同時補 ORM 與 `sql/00X`、跑 `uv run pytest` 與 `pylint`。

### CAS 的擴充邊界（最終決策）

CAS 必須是一個**清楚界定、bounded 的模組**，不得把商業邏輯散落在 Jellyfish 各處。
建議採用與現有 repo 相容的結構（實際路徑可依 Jellyfish 慣例微調）：

```
backend/app/crypto_animal_studio/
  api/            # 對外路由（薄，回 ApiResponse）
  application/    # 用例/流程編排（含同步匯入 service）
  domain/         # CAS 領域模型與規則
  schemas/        # EpisodePackage 等 Pydantic 契約
  agents/         # CAS 專屬 agent（若需要）
  integrations/   # 與 Jellyfish Provider/Model/ModelSettings 的橋接
  tests/          # 模組自帶測試
```

CAS 擴充的硬性約束：
- **重用，不重複**：不得建立平行的 CAS Project／Episode／Shot／Asset／Media／Prompt／Task 系統；
  一律呼叫 Jellyfish 既有 `services/studio/*`、任務中心、檔案/儲存、PromptTemplate。
- **Provider 收斂**：CAS 最終**必須**使用 Jellyfish 的 `Provider / Model / ModelSettings`。
  過渡期可用**臨時 adapter**，但**不得**遷移或保留第二套獨立的 provider 設定系統。
- **不新增 enum**：初期整合**不新增** `ProjectStyle` 或 `ProjectVisualStyle` 列舉值（沿用既有值）。
- **第一里程碑同步**：先做 `EpisodePackage → validation → 同步匯入 → Chapter+Shots 可見`，
  **暫不實作 Celery 任務**。
- **不改契約根基**：不動 `ApiResponse`、既有 `sql/00X` 遷移、`front/services/generated`、既有 enum 值。

---

## 19. 哪些模組不應修改（Do-Not-Modify / 高風險）

1. **`core/db.py` 的 async/prefork 機制與 `reset_db_runtime`**：牽動 Celery 事件迴圈正確性。
2. **`main.py` 例外處理與 `ApiResponse` 殼**：全域契約，改了會波及所有端點與前端。
3. **`schemas/common.py`（ApiResponse/分頁）**：契約根基。
4. **`front/src/services/generated/`**：自動產生物，手改會被覆蓋。
5. **`sql/001–008` 既有遷移**：只能往後加 `009+`，不可回改。
6. **`PromptTemplate.is_system` 的系統預置**：接口層明訂禁止刪改。
7. **`models/types.py` 既有 enum 值**：可新增成員，不可改/刪既有值（DB 已存字面值）。
   **但初期 CAS 整合連「新增」都不做**——不新增 `ProjectStyle` / `ProjectVisualStyle`。
8. **task registry key 語意 `(task_kind, provider_key)`**：衝突會在啟動註冊時報錯。
9. **不得建立 CAS 平行系統**：Project／Episode／Shot／Asset／Media／Prompt／Task 一律重用 Jellyfish 既有系統。
10. **不得保留第二套 provider 設定系統**：CAS 收斂到 Jellyfish `Provider/Model/ModelSettings`（過渡期僅允許臨時 adapter）。

---

## 20. 建議的 CAS（Crypto Animal Studio）Integration Point

> 反映最終決策；本文件僅描述切入點，**不含實作**。

CAS 產物是「news → 劇集 + 對白 + **已完成 storyboard** + 角色設定」（EpisodePackage）。整合切入點已定案：

1. **Bounded 模組（唯一落點）**
   全部 CAS 邏輯收斂在一個界定清楚的模組（路徑可依 Jellyfish 慣例微調）：
   `backend/app/crypto_animal_studio/{api,application,domain,schemas,agents,integrations,tests}`。
   **不得**把邏輯散落到 `services/studio/*` 各處。

2. **主切入點：EpisodePackage → 同步匯入 service（第一里程碑）**
   `Sample EpisodePackage → validation → synchronous import service → Chapter + Shots 可見`。
   匯入 service 建/取 **Project（= series/season）** → 建 **Chapter**（`raw_text` = 完整劇本，追溯用）
   → 由 storyboard **直接**建 `Shot / ShotDetail / ShotDialogLine`。**第一里程碑不使用 Celery。**

3. **直接映射 storyboard，禁止回送拆鏡**
   Shots 一律由 **EpisodePackage** 建立；**不得**把已完成 storyboard 再送回 `ScriptDividerAgent`
   （保護 comedy beats / timing / dialogue alignment / shot structure）。匯入的 Shot 可 `skip_extraction`。

4. **角色與資產：重用既有系統**
   Bull/Bear/Fox/Hammy/Monkey/Walter → 既有 `Character`（各綁 `Actor` 作視覺身份）+ 資產連結，
   呼叫既有 `services/studio/entities.py` 等。**不建立平行的 CAS 角色/資產系統。**

5. **對外介面：一條薄路由（回 `ApiResponse`）**
   由 `crypto_animal_studio/api/` 掛一條匯入端點（例：`POST /api/v1/crypto-animal/import`）。
   前端重跑 `openapi:update` 取得型別。**不新增平行 Task 系統**；後續要非同步再沿用既有任務中心。

6. **Provider：收斂到 Jellyfish 治理**
   CAS 最終**必須**使用 Jellyfish `Provider / Model / ModelSettings`。過渡期允許**臨時 adapter**
   （放 `crypto_animal_studio/integrations/`），但**不得**保留第二套獨立 provider 設定系統。

7. **不新增 enum（初期）**
   初期整合沿用既有 `ProjectStyle` / `ProjectVisualStyle` 值，**不新增**列舉、**不建**資料庫遷移。

---

## 21. 附錄：關鍵事實速記

- Python 3.12；`uv` 管理；FastAPI + LangChain/LangGraph + SQLAlchemy async。
- DB 預設 SQLite，可切 MySQL/PostgreSQL；27 張表；遷移 `sql/001–008`。
- 回應殼 `ApiResponse{code,message,data,meta}`；錯誤語彙統一。
- 任務：TaskManager（可插拔）+ Celery（`task_kind`→registry→executor）+ `GenerationTask` 持久。
- 生成供應商：openai / volcengine（image+video）、aliyun_bailian（text）。
- 前端契約由 OpenAPI 產生，`generated/` 勿手改。
- 一致性/資產重用是核心設計；Character(敘事) 與 Actor(視覺) 分離。
- 本文件為架構文件；本次僅更新文件以反映最終決策，**未變更任何原始碼、未安裝套件、未建立資料庫遷移**。

---

## 22. Risks and open decisions（風險與待決事項）

反映最終決策後，仍待處理或需持續留意的事項：

| # | 項目 | 現況 / 決策 | 待決或風險 |
|---|---|---|---|
| R1 | CAS 授權 | **尚未正式確定**（先前「Proprietary」之敘述已移除，因無依據） | vendored / 對外發佈前需正式確立授權；影響能否併入 Apache-2.0 repo。 |
| R2 | Provider 收斂 | 最終走 Jellyfish `Provider/Model/ModelSettings`；過渡允許臨時 adapter | 需訂「臨時 adapter 退場時程」，避免第二套設定長存。 |
| R3 | 系列/季粒度 | Project = series/season，含多個 Chapter/Episode | 需定義 Project 建立/選取規則（何時新開 Project vs 沿用）。 |
| R4 | ShotDetail 欄位覆蓋 | storyboard 直接填 camera/duration/dialogue | CAS storyboard 未必涵蓋所有 ShotDetail 欄位；缺項的預設策略待定。 |
| R5 | raw_text 與 Shots 一致性 | raw_text 保存完整劇本、Shots 由 EpisodePackage 建立 | 兩者為不同來源，需避免被誤解為「raw_text 會被重新拆鏡」。 |
| R6 | 角色/資產去重 | 重用既有 `Character`/`Actor`/資產 | 跨集/跨 Project 的實體重用與命名一致性策略待定。 |
| R7 | 非同步化時機 | 第一里程碑同步、無 Celery | 何時、以何準則升級為既有任務中心的非同步任務待定。 |
| R8 | enum 缺口 | 初期不新增 `ProjectStyle`/`ProjectVisualStyle` | 若未來確需喜劇/動漫專屬 style，屬**後續**決策（新增成員 + `sql/009`）。 |

---

## Final Architecture Decisions

以下為已定案（Final）之架構決策，採 ADR 風格記錄。除非另立新 ADR，否則後續實作須遵循。

| # | Decision（決策） | Status | Reason（理由） | Consequences（後果／影響） |
|---|---|---|---|---|
| ADR-1 | 一個 CAS Episode 對映一個 Jellyfish **Chapter** | Final | Chapter 已是章節級劇本+分鏡容器，語意最貼近「一集」 | 匯入以 Chapter 為單位；不需新增 Episode 實體。 |
| ADR-2 | Jellyfish **Project = 系列/製作/季**，可含多個 CAS Chapter/Episode | Final | 對齊影視「一部作品含多集」的結構 | 需定義 Project 建立/選取規則（見 R3）；資產在 Project 層跨集重用。 |
| ADR-3 | CAS 將 storyboard **直接**映射為 Chapter/Shot/ShotDetail/ShotDialogLine + 角色/資產連結 | Final | 保留 CAS 既完成之鏡頭與對白結構，最高保真 | 匯入器負責建這些列；跳過抽取候選；Shot 可 `skip_extraction`。 |
| ADR-4 | **不得**把已完成 storyboard 回送 `ScriptDividerAgent` | Final | 重新拆鏡會破壞 comedy beats、timing、dialogue alignment、shot structure | CAS 匯入路徑刻意繞過拆鏡與 ElementExtractor 候選流程。 |
| ADR-5 | `Chapter.raw_text` 保存**完整生成劇本**供追溯；**Shots 由 EpisodePackage 建立** | Final | 兼顧可追溯性與鏡頭保真 | raw_text 與 Shots 為不同來源；raw_text 不被重新拆鏡。 |
| ADR-6 | **不建立**平行的 CAS Project/Episode/Shot/Asset/Media/Prompt/Task 系統 | Final | 避免雙軌資料與維運分裂 | 一律重用 Jellyfish 既有 `services/studio/*`、任務中心、儲存、PromptTemplate。 |
| ADR-7 | CAS 為**界定清楚的 bounded 模組**（`backend/app/crypto_animal_studio/{api,application,domain,schemas,agents,integrations,tests}`；路徑可依慣例微調） | Final | 防止商業邏輯散落，利於維護與測試 | 所有 CAS 邏輯集中於此模組；對外只經薄 api 層。 |
| ADR-8 | CAS 最終使用 Jellyfish **Provider/Model/ModelSettings**；過渡期允許臨時 adapter | Final | 統一模型治理，避免密鑰/設定分裂 | 不得遷移或保留第二套 provider 設定系統；adapter 需有退場計畫（R2）。 |
| ADR-9 | **第一里程碑不實作 Celery**：Sample EpisodePackage → validation → 同步匯入 service → Chapter+Shots 可見 | Final | 先以最小、可驗收的同步路徑降風險 | 非同步任務化延後；驗收點為 Jellyfish 內可見 Chapter 與 Shots。 |
| ADR-10 | 初期整合**不新增** `ProjectStyle` / `ProjectVisualStyle` enum | Final | 降低 schema/遷移面積，先跑通主路徑 | 沿用既有列舉值；style 擴充屬後續決策（R8）。 |
| ADR-11 | 移除「CAS 為 Proprietary」之未經證實敘述 | Final | 授權尚未正式確定，原敘述無依據 | 文件不再宣稱 CAS 授權；授權為待決事項（R1）。 |
