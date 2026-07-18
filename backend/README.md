
# Jellyfish Backend

基于 FastAPI + LangChain/LangGraph + SQLAlchemy 的后端 API，使用 **uv** 管理依赖。

## 技术栈

- **FastAPI**：Web 框架
- **LangChain / LangGraph**：链与工作流编排，`PromptTemplate` 管理提示词
- **SQLAlchemy**：异步 ORM，默认 SQLite（可换 PostgreSQL 等）
- **uv**：包管理与虚拟环境

## 目录结构

```
backend/
├── pyproject.toml          # 项目与依赖（uv）
├── .python-version        # Python 版本
├── app/
│   ├── __init__.py
│   ├── main.py             # FastAPI 入口
│   ├── config.py           # 配置（pydantic-settings）
│   ├── dependencies.py     # 依赖注入（如 get_db）
│   ├── api/
│   │   └── v1/
│   │       ├── __init__.py # 路由聚合
│   │       └── routes/     # 各模块路由
│   ├── core/
│   │   └── db.py           # SQLAlchemy 引擎与 Base
│   ├── models/             # ORM 模型
│   ├── schemas/            # Pydantic 请求/响应
│   ├── services/           # 业务逻辑
│   └── chains/             # LangChain PromptTemplate、LangGraph
├── tests/
├── .env.example
└── README.md
```

## 当前分层约定

目前后端已经按“**路由层瘦身，业务逻辑下沉**”的方向整理过一轮，建议后续继续遵循下面这套分工：

- `app/api/v1/routes/`
  - 负责收参、依赖注入、调用 service、包装响应
- `app/services/common/`
  - 负责通用校验、通用 CRUD、公共错误文案
- `app/services/studio/`
  - 负责项目、章节、分镜、文件、图片任务等 Studio 主业务
- `app/services/llm/`
  - 负责 Provider / Model / Settings 管理逻辑
- `app/services/film/`
  - 负责视频生成、分镜帧提示词任务等编排逻辑

推荐遵循的判断标准：

- **留在 route 的**
  - 参数解析
  - `Depends`
  - 调 service
  - 返回 `ApiResponse`
- **放到 service 的**
  - 跨实体校验
  - 默认值策略
  - 文件/存储交互
  - 任务编排
  - AI 工作流调用

## 响应与错误约定

当前接口已经统一使用 `ApiResponse` 响应壳，后续新增接口也建议保持一致：

- 创建成功：`created_response(...)`
- 普通成功：`success_response(...)`
- 空响应成功：`empty_response()`
- 分页成功：`paginated_response(...)`

错误风格也已开始统一，优先复用：

- `entity_not_found(...)`
- `entity_already_exists(...)`
- `required_field(...)`
- `invalid_choice(...)`
- `not_belong_to(...)`

## 快速开始

### 1. 安装 uv（若未安装）

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 2. 进入 backend 并安装依赖

```bash
cd backend
uv sync
```

### 3. 配置环境

```bash
cp .env.example .env
# 按需编辑 .env
```

### 4. 初始化数据库（Alembic）

如果你使用的是 **SQLite 默认配置**（`DATABASE_URL=sqlite+aiosqlite:///./jellyfish.db`），可以跳过本节，首次访问时会自动创建文件。

使用 MySQL 等外部数据库时，必须先运行 Alembic 迁移和系统种子：

1. 在 `.env` 中配置数据库连接（示例）：

   ```env
   # SQLite（默认）
   # DATABASE_URL=sqlite+aiosqlite:///./jellyfish.db

   # MySQL（使用 aiomysql 驱动）
   # DATABASE_URL=mysql+aiomysql://user:pass@localhost:3306/jellyfish

   # PostgreSQL
   # DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/jellyfish
   ```

2. 运行迁移和系统种子（使用 uv）：

   ```bash
   cd backend
   uv sync
   uv run python -m app.scripts.migrate_database
   uv run python -m app.scripts.seed_system_data
   ```

空数据库会执行 `alembic upgrade head`；由旧初始化流程创建且结构完整的数据库会先安全登记在初始 Alembic revision，再执行后续 revision。部分表缺失时命令会拒绝登记，避免隐藏不完整 schema。

### 5. 启动服务

```bash
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- API 文档：http://localhost:8000/docs  
- 健康检查：http://localhost:8000/health  
- API v1 示例：http://localhost:8000/api/v1/example/prompt  
- 影视技能（确认路由）：http://localhost:8000/api/v1/film （GET）；实体/分镜抽取见下方，需 **POST** 且路径带 **/api/v1** 前缀。

### 影视技能 API（需配置 OPENAI_API_KEY）

| 方法 | 完整路径 | 说明 |
|------|----------|------|
| GET  | `/api/v1/film` | 返回端点说明，用于确认路由已注册 |
| POST | `/api/v1/film/extract/entities` | 人物/地点/道具抽取 |
| POST | `/api/v1/film/extract/shotlist` | 分镜/镜头表抽取 |

未配置 `OPENAI_API_KEY` 时上述 POST 返回 503。

## 常用命令

| 命令 | 说明 |
|------|------|
| `uv sync` | 安装/同步依赖 |
| `uv sync --group dev` | 同步依赖并包含开发组（pytest、pylint 等） |
| `uv add <pkg>` | 添加依赖 |
| `uv run uvicorn app.main:app --reload` | 开发运行 |
| `uv run pytest` | 运行测试 |
| `uv run pytest tests/... -q` | 运行定向测试 |
| `uv run pylint app` | 对 `app` 包运行 Pylint（需已 `uv sync --group dev`） |
| `python -m py_compile <paths>` | 快速做语法检查 |

## 代码检查（Pylint）

与常见开源 Python 项目一致，Pylint 选项集中在 [`pyproject.toml`](pyproject.toml) 的 `[tool.pylint.*]`（行宽、Python 版本、`jobs=1` 等；并对 SQLAlchemy / 文档串等噪声规则做了合理关闭）。

```bash
cd backend
uv sync --group dev
uv run pylint app
```

- **Pylint**：未使用导入、风格问题、部分可维护性告警等。  
- **BasedPyright**：类型检查配置在同文件 `[tool.basedpyright]`，供 IDE 或本机已安装的 `basedpyright` CLI 使用；与 Pylint 互补（类型 vs 风格/模式）。
- **CI**：变更 `backend/**` 的 PR（及启用 Merge queue 时的合并组）会运行仓库根目录下的 [`.github/workflows/backend-pylint.yml`](../.github/workflows/backend-pylint.yml)。若要将 Pylint 作为合并前置，请在 GitHub **分支保护 / Rules** 中把对应状态检查（一般为 **Backend Pylint / pylint**）设为必需，详见该 workflow 文件头注释。

## 测试

### 推荐入口

现在无论你在仓库根目录还是 `backend/` 目录运行，pytest 都已经做了统一配置。

在 `backend/` 目录：

```bash
cd backend
uv run pytest -q
```

在仓库根目录：

```bash
uv run pytest backend/tests -q
```

### 常用定向测试

运行 service 层测试：

```bash
cd backend
uv run pytest \
  tests/test_common_services.py \
  tests/test_llm_manage.py \
  tests/test_shot_character_links.py \
  tests/test_script_division.py \
  tests/test_studio_files_service.py \
  tests/test_generated_video_service.py \
  tests/test_shot_frame_prompt_tasks_service.py \
  tests/test_image_task_services.py \
  -q
```

运行 API 响应壳测试：

```bash
cd backend
uv run pytest \
  tests/test_api_response_envelopes.py \
  tests/test_llm_api_responses.py \
  tests/test_studio_prompts_categories.py \
  tests/test_studio_api_responses.py \
  tests/test_shot_subresource_api_responses.py \
  tests/test_files_api_responses.py \
  tests/test_task_status_api_responses.py \
  tests/test_shot_character_links_api_responses.py \
  tests/test_image_tasks_api_responses.py \
  tests/test_generated_video_api_responses.py \
  tests/test_tasks_images_api_responses.py \
  -q
```

### 当前测试重点

当前测试主要覆盖三类目标：

- **公共层**
  - 通用校验、通用 CRUD、公共错误文案
- **service 层**
  - `studio`、`llm`、`film` 的关键业务服务
- **API 层**
  - 创建/删除/异常时的 `ApiResponse` 外层结构

如果只是快速验证本轮改动，建议优先：

```bash
cd backend
uv run pytest tests/test_common_services.py tests/test_studio_api_responses.py -q
```

### 语法级快速检查

在做较大重构但暂时不想跑全量测试时，可以先做一轮语法检查：

```bash
cd backend
python -m py_compile $(rg --files app tests)
```

### 说明

- 根目录 `pytest.ini` 已补齐，避免从仓库根目录执行时异步测试被误跳过
- 异步测试统一使用 `@pytest.mark.asyncio`
- 真实 LLM 联调前，请先执行 `uv sync --group dev`

## 扩展说明

- **数据库**：在 `app/models/` 下新增模型并继承 `Base`，在 `app/core/db.py` 中可调用 `init_db()` 建表。
- **提示词**：在 `app/chains/prompts.py` 中增加 `PromptTemplate`。
- **工作流**：在 `app/chains/graphs.py` 中定义 `StateGraph` 并 `compile()`，在路由中 `ainvoke` 调用。
