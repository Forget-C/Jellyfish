# 本地切换「演练模式 / 真实模式」操作手册

> 适用版本：本仓库当前分支（FastAPI 后端 + React 前端）。
> 相关代码：`backend/app/services/studio/llm_orchestration/dry_run.py`（守卫本体）、
> `backend/app/services/paid_outlet_guard.py`（把老链路也接到同一套闸门）、
> `GET /api/v1/studio/llm/orchestration/status`（状态接口）、
> 前端角标 `front/src/pages/aiStudio/components/RealRunModeBadge.tsx`。

---

## 0. 一句话结论

- **默认就是演练模式**：不发任何真实请求、不产生任何费用。删掉两个开关就回到这个状态。
- **两个开关写在两处都生效**：进程环境变量（`export` / 启动脚本 / 容器 env）与
  `backend/.env` 都认，**进程环境变量优先于 `.env`**；两处都没写才落到默认值（演练）。
- **切到真实模式只需两件事**：设好两个开关，然后**重启后端进程**。
- **如果真实模式是由 `backend/.env` 打开的，后端启动时会打一条醒目中文告警**，
  状态接口里的 `switch_source` 字段也会标出开关来源是 `env` 还是 `dotenv`。
- 页面右上角角标和状态接口都会如实告诉你现在是哪一种模式；被守卫拦住时，接口返回的错误里
  直接带「原因 + 怎么开」。

| 模式 | 判定条件 | 行为 |
| --- | --- | --- |
| 演练模式（默认） | `JELLYFISH_DRY_RUN` 两处都没写 / `1` / `true` / `yes` / `on` | 四个付费出口全部拦截，返回占位结果，**零费用** |
| 真实模式（未确认） | `JELLYFISH_DRY_RUN=0` 但 `JELLYFISH_REAL_LLM_CONFIRMED` 不是 `1` | 仍然拦截，原因明确写「缺少付费确认」 |
| 真实模式 | `JELLYFISH_DRY_RUN=0` **且** `JELLYFISH_REAL_LLM_CONFIRMED=1` | 允许真实调用，**会花钱**，成本确认/限额/去重仍生效 |

### 开关解析优先级（唯一口径）

| 优先级 | 来源 | 说明 |
| --- | --- | --- |
| 1（最高） | 进程环境变量 `os.environ` | `export`、启动脚本、容器 `environment:` |
| 2 | `backend/.env` | 经 pydantic-settings 读进 `Settings`；与 1 同等有效，但优先级更低 |
| 3（最低） | 默认值 | 两处都没写 → 演练 / 未确认 |

- 解析只在一处：`backend/app/services/studio/llm_orchestration/dry_run.py` 的
  `flag_raw()` / `flag_source()`，其它地方（含状态接口、拦截错误体）一律复用，不存在第二套口径。
- **fail-safe**：取值读不懂（例如 `JELLYFISH_DRY_RUN=maybe`）、`Settings` 读不到、
  读取过程抛任何异常 → 一律当「未设置」处理；而「未设置」对演练开关就是**演练**，
  绝不会因为读不到就放行真实付费调用。

---

## 1. 前置条件

1. 后端依赖与数据库就绪（`cd backend && uv sync`，`uv run python init_db.py`）。
2. 要用到的出口必须先在「模型管理」里配好：默认文本模型 / 图片模型 / 视频模型，
   以及它们挂的供应商（`api_key`、`base_url`）。**没配置的出口即使开了真实模式也会失败。**
3. 想清楚费用：真实模式下每一次调用都按供应商计价（大模型按 token、出图按张、出视频按次、
   OSS 按存储与流量）。
4. 真实模式下建议**单独一个终端**跑后端，方便用完立刻关回演练。

---

## 2. 怎么开真实模式

### 方式 A：临时开（推荐，用完立刻关）

在**启动后端的那一个终端**里执行（两个变量必须在同一个 shell 里）：

```bash
cd /path/to/仓库根/backend
export JELLYFISH_DRY_RUN=0
export JELLYFISH_REAL_LLM_CONFIRMED=1

# 然后启动后端（这条就是仓库 README 里那条命令）
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

跑完之后，**在这个终端里**关回演练（见第 4 节），再重启。

> ⚠️ **为什么必须重启**：守卫在每一次真实动作前都会重新解析开关，但**外部改不了
> 已经启动的进程的环境变量**，`.env` 也只在进程启动时被 pydantic-settings 读一次。
> 所以在另一个终端 `export`、或者改完不重启，都不会生效。

### 方式 A2：写进 `backend/.env`（也生效，但会打真实付费告警）

`backend/.env` 里的这两个键**真的会生效**（守卫按「进程环境变量 → `.env` → 默认值」解析）：

```bash
cd /path/to/仓库根/backend
# .env 里追加（注意：这一步就是"把付费闸门打开"，别提交这个文件）
printf 'JELLYFISH_DRY_RUN=0\nJELLYFISH_REAL_LLM_CONFIRMED=1\n' >> .env
# 重启后端进程后生效
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

后端启动时会在日志里打一条**醒目中文告警**（`!!` 框起来，`WARNING` 级别）：

```
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
【告警】检测到由 backend/.env 打开的真实付费模式：
    JELLYFISH_DRY_RUN=0 且 JELLYFISH_REAL_LLM_CONFIRMED=1（来自 backend/.env 的键：...）。
    真实模式下大模型按 token、出图按张、出视频按次真实计费，请求会真的发出去。
    请确认这是你要的；CI/测试环境请用演练模式。
    ...
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
```

> 为什么不推荐：`.env` 通常被 `.gitignore` 忽略，改它不进代码评审，也看不出是谁什么时候
> 打开的，是最容易「悄悄开出去」的一条路。临时验证请优先用方式 A（`export`），
> 让「谁开的」留在 shell 历史里。
>
> 想用进程环境变量**临时压掉** `.env` 里的真实模式（进程环境变量优先）：
> `export JELLYFISH_DRY_RUN=1` 后重启。

### 方式 B：用仓库自带的启动脚本（自带二次确认与模式回显）

```bash
bash backend/scripts/run_backend.sh --status   # 只看当前 shell 里的模式判定，不启动
bash backend/scripts/run_backend.sh            # 演练模式启动（默认，安全）
bash backend/scripts/run_backend.sh --real     # 真实模式启动，需要按提示确认一次
bash backend/scripts/run_backend.sh --real --yes   # 非交互环境（CI/脚本）用
```

脚本只做三件事：设好两个变量（用 `export` 覆盖 `.env` 里的可能残留）→ 打印当前模式 →
`exec uv run uvicorn ...`。它**不改**默认启动方式，不用它也一样能跑（方式 A 就是等价的）。

### 方式 C：容器 / 部署环境

把这两个变量写进容器的环境变量（`deploy/` 下的 compose 或编排配置的 `environment:`）最稳妥。
容器里也读 `.env`，但容器镜像里的 `.env` 更容易被误带进生产，所以还是显式环境变量优先。

---

## 3. 怎么确认现在是哪种模式

三种方式，任选其一，结论一致：

**① 状态接口（最权威）**

```bash
curl -s http://localhost:8000/api/v1/studio/llm/orchestration/status | python3 -m json.tool | head -40
```

重点看 `data` 里的这几个字段：

| 字段 | 含义 |
| --- | --- |
| `mode` | `dry_run` / `real_unconfirmed` / `real` |
| `mode_label` | 中文模式名：`演练模式` / `真实模式（未确认）` / `真实模式` |
| `is_real_mode` | 是否真的放行（只有两个开关都对才是 `true`） |
| `guard.dry_run` / `guard.real_call_confirmed` | 两个开关的实时取值 |
| `switch_source` / `switch_source_label` | 开关**写在哪**：`env`（进程环境变量）/ `dotenv`（`backend/.env`）/ `default`（都没写），中文名同 `guard.source_label` |
| `dotenv_real_mode` | `true` = 真实模式是由 `backend/.env` 打开的（后端启动时会告警） |
| `guard.source` / `guard.dry_run_source` / `guard.real_call_confirmed_source` | 每个开关**各自**的来源，排查「.env 和 export 打架」时看这里 |
| `outlet_states[]` | 四个出口（大模型/出图/出视频/对象存储上传）各自 `allowed` 与拦截原因 |
| `enable_steps` / `restore_steps` | 中文的开启步骤与恢复步骤 |
| `dry_run_audit` | 最近的拦截/放行审计（排查「刚才为什么没发出去」） |

**② 页面角标**：打开前端，右上角有「演练模式」/「真实模式」标签，点开可以看到每个出口的
放行情况、开启步骤，以及最近被拦截的记录。

**③ 不启动服务，只看环境变量判定**

```bash
cd backend && uv run python - <<'PY'
from app.services.studio.llm_orchestration import dry_run
print(dry_run.mode_label(), dry_run.mode())
print(dry_run.state())
PY
```

---

## 4. 怎么关回演练模式

在**启动后端的终端**里：

```bash
unset JELLYFISH_DRY_RUN JELLYFISH_REAL_LLM_CONFIRMED
# 或者显式写死：export JELLYFISH_DRY_RUN=1
```

**两处都要清**：如果 `backend/.env` 里也写过这两个键，光 `unset` 是不够的
（`.env` 里还写着 `JELLYFISH_DRY_RUN=0`，进程环境变量又没设，守卫就会按 `.env` 放行）。
检查并清掉：

```bash
cd backend && grep -nE 'JELLYFISH_(DRY_RUN|REAL_LLM_CONFIRMED)' .env || echo "（.env 里没有这两个键，安全）"
# 有输出就手动删掉那两行，或把 JELLYFISH_DRY_RUN 改成 1
```

重启后端进程，然后按第 3 节确认：`data.mode` 应该是 `dry_run`、`data.guard.dry_run` 应该是
`true`、`data.switch_source` 应该是 `default`（或你在环境变量里显式写的 `env`），
页面角标回到「演练模式」。

> 想更保险：`JELLYFISH_DRY_RUN` 只要不设置（或设成任意非 0/false/no/off 的值）就是演练模式；
> 取值读不懂时一律按**演练**处理（fail-safe）。

---

## 5. 真实模式下**依然存在**的成本约束（没有放开撒钱）

开真实模式只是把「演练闸门」放开，下面这些钱相关的保护**一条都没少**：

1. **调用前的确认弹窗 / 二次确认**：批量生成资产图片提示词时，默认只勾选缺失的资产
   （最多 3 个，`DEFAULT_SELECT_LIMIT`），要放大批量必须手动「全选缺失」；一旦超过 10 个
   （`CONFIRM_THRESHOLD`）会先弹一次「确认对 N 个资产调用大模型生成提示词？每个资产一次调用
   （会花钱）」再执行。相关代码：`front/src/pages/aiStudio/project/ProjectWorkbench/components/AssetImagePromptLlmPanel.tsx`。
2. **批量上限与中断**：批量任务是**逐条串行**调用，随时可以点「停止后续」（当前这条跑完，
   后续不再开始）；失败的可以单独「重试失败项」，不会连带重跑已成功的。
3. **去重 / 幂等**：
   - 出图提交带上稳定幂等键 `source_task_id = jellyfish:{project_id}:{asset_type}:{asset_id}:{sha1(prompt)[:8]}`，
     同一项目 + 同一资产 + 同一提示词重复提交会被出图服务识别为**同一个任务**，不会重复出图
     （`backend/app/services/studio/image_pipeline/image_pipeline.py:build_source_task_id`）。
   - 默认「只勾选缺失资产」「已有提示词的会被跳过」，避免把已经做过的事再做一遍。
   - 视频提示词的动作节拍合并去了重（`_dedupe_keep_order`，上限 4 条），避免同义重复堆数量。
4. **出口级闸门**：任务是「先建行、后执行」的，执行入口还会再查一次
   （`paid_outlet_guard.task_kind_block_reason`）：即使有人绕过了接口层建出 `image_generation`
   / `video_generation` 任务，回放时也会被守卫拦下并标记失败，不会真花钱。
5. **出站兜底**：`install_network_guard()` 给 `httpx` 打的补丁**只在演练模式下**掐断非本机出站；
   真实模式下不再拦截出站，所以第 1 节的「配好模型/供应商」才是硬前提。

> 结论：真实模式 ≠ 免确认。它只是让你能成功调用；确认、限额、去重三件事照旧。

### 5.1 只授权**部分出口**：`JELLYFISH_ALLOWED_OUTLETS`（2026-09 新增）

两个开关只能表达"整体开 / 整体关"，表达不了"**只授权文本模型**、不授权出图 / 出视频 / 上传"。
验收场景（用户只授权 5 次文本调用）就需要后者，所以多了一道**出口白名单**：

```bash
# 只允许文本模型真实调用；图片 / 视频 / OSS 三个出口在**代码层面**被拦（409 outlet_not_allowed）
JELLYFISH_DRY_RUN=0 JELLYFISH_REAL_LLM_CONFIRMED=1 JELLYFISH_ALLOWED_OUTLETS=llm \
  uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

- 取值：`,` 分隔的出口名（`llm` / `image` / `video` / `oss`，容忍中文逗号与空格、大小写）；
- 写成 `none` / `off` / `0` → **四个出口全部禁止**（"临时全停"）；
- **未设置**（默认）→ 不额外限制，行为与加这个功能之前完全一致；
- 空值 / 读不懂 → 按"未设置"处理（fail-safe：与守卫其余部分同口径，不会因为写法怪就误放开）；
- 判定顺序：**先看是不是真实模式，再看出口白名单**。所以白名单只在真实模式下有意义，
  演练模式下四个出口本来就全禁。

状态接口如实回报：

```bash
curl -s http://localhost:8000/api/v1/studio/llm/orchestration/status \
  | python -c "import json,sys;d=json.load(sys.stdin)['data']['real_run_mode'];print(d['allowed_outlets']);[print(o['outlet'],o['allowed'],o['reason']) for o in d['outlets']]"
# 期望（白名单=llm 时）：['llm']；llm True / image False outlet_not_allowed / video False … / oss False …
```

被拦时返回结构化 **409**（`code=paid_outlet_blocked`、`reason=outlet_not_allowed`），
`paid_call_made` 恒为 `false` —— 也就是"**没有发出任何真实请求**"。

---

## 6. 常见坑

1. **`.env` 和进程环境变量打架。** 两处都生效，**进程环境变量优先**。典型症状：
   `.env` 里写着 `JELLYFISH_DRY_RUN=0`，你以为 `unset` 就关回去了，其实 `.env` 还在放行
   （`switch_source` 会显示 `dotenv`，启动日志里也有醒目告警）。排查顺序：
   先看状态接口的 `switch_source` / `guard.dry_run_source`，再 `grep` 一遍 `backend/.env`。
2. **只设了一个变量。** 只设 `JELLYFISH_DRY_RUN=0`（`export` 或 `.env` 都一样）会停在
   「真实模式（未确认）」，错误原因写的是 `real_call_not_confirmed`，仍然不会发真实请求
   ——这是设计如此，不是 bug。
3. **改完开关没重启进程。** 包括 `--reload` 的情况：`--reload` 只在**代码变更**时重启，
   环境变量变了、`.env` 改了都必须自己重启（`Ctrl+C` 再起）。`.env` 是进程启动时读一次的。
4. **worker / Celery 进程是另一套环境。** 如果真实调用由 worker 执行，**worker 进程**也必须
   能在它自己的工作目录里读到这两个开关（它也会读自己工作目录下的 `.env`），
   否则任务会在执行入口被拦下并标记失败。
5. **前端角标显示「模式未知」。** 说明读不到状态接口：后端没起、端口不对
   （默认 `http://localhost:8000`，可用 `VITE_BACKEND_URL` 覆盖），或 CORS 拦住了。
   在确认之前请按「不会真花钱」对待。
6. **只关掉 `JELLYFISH_DRY_RUN` 而忘了确认变量**，或者反过来把确认变量设成 `0`/`no`，
   都不算开启（`real_call_confirmed` 只认 `1/true/yes/on` 这类真值）。
7. **演练模式下有些接口会返回占位产物**（例如 `dry-run.invalid` 域名下的图片地址、
   `status: dry_run` 的任务）。这些地址不可访问是**预期行为**，不要当成故障去"修"。
8. **别把真实模式当默认。** 需要付费的验证请开一个独立终端、用完立刻关回演练；
   提交代码时不要带任何真实开关的环境文件（`.env` 不进库）。
9. **测试里不会被 `.env` 打开真实模式。** 测试套件有 autouse 夹具
   （`backend/tests/conftest.py::_force_dry_run_in_tests`）把两个来源都钉成「未设置」，
   即使本机 `.env` 打开了真实模式，跑测试也不会真实付费。

---

## 7. 相关测试（都不会产生真实费用）

```bash
# 后端：模式判定 / 出口放行 / 结构化拦截错误 / 状态接口 / .env 开关与优先级
cd backend && DATABASE_URL="sqlite+aiosqlite:////tmp/jf_test.db" \
  uv run python -m pytest -q tests/test_dry_run_real_mode.py tests/test_dry_run_dotenv_switch.py \
  tests/test_paid_outlet_guard.py -p no:cacheprovider

# 前端：模式解析与拦截错误解析（纯逻辑）
cd front && node --test src/pages/aiStudio/components/realRunModeCore.test.ts
```

守卫相关代码的位置速查：

| 关注点 | 位置 |
| --- | --- |
| 开关判定（含 `.env` 解析与优先级）、模式、中文步骤 | `backend/app/services/studio/llm_orchestration/dry_run.py` |
| `backend/.env` 里的两个开关字段（`jellyfish_dry_run` / `jellyfish_real_llm_confirmed`） | `backend/app/config.py` |
| 启动告警（`dry_run.startup_warning()` 的调用点） | `backend/app/main.py`（`lifespan`） |
| 拦截异常与结构化 409 | `backend/app/services/paid_outlet_guard.py`、`backend/app/main.py` |
| 状态接口 | `backend/app/api/v1/routes/studio/llm_orchestration.py`（`GET /api/v1/studio/llm/orchestration/status`） |
| 测试「默认演练」的保险丝 | `backend/tests/conftest.py`（autouse 夹具 `_force_dry_run_in_tests`） |
| 前端角标 | `front/src/pages/aiStudio/components/RealRunModeBadge.tsx` |
| 前端纯逻辑 | `front/src/pages/aiStudio/components/realRunModeCore.ts` |
| 前端接口封装 | `front/src/services/orchestrationStatusApi.ts` |
| 本地启动脚本 | `backend/scripts/run_backend.sh` |
