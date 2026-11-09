# 本地开发

使用 macOS 或 Linux 在宿主机上运行 API、Worker 和前端，用 Docker Compose 提供 MySQL 和 RustFS。应用的完整容器部署见 [Docker 部署](../../../site/content/docs/getting-started/docker.md)。官网开发和预览见 [站点维护说明](../../../site/README.md)。

## 准备环境

安装 Docker 和 Compose、uv、Python、Node.js 和 pnpm。开发版本见 [Python](../../../backend/.python-version)、[Node.js](../../../front/.node-version) 与 [前端包配置](../../../front/package.json)。

首次开发时，从仓库根目录复制配置。已有本地配置时核对模板差异，保留自己的值。

```bash
cp deploy/compose/.env.example deploy/compose/.env
cp backend/.env.example backend/.env
cp front/.env.example front/.env
docker compose --env-file deploy/compose/.env -f deploy/compose/docker-compose.yml \
  up --build -d mysql rustfs backend-migrate backend-seed-system-data
```

用同一 Compose 命令的 `ps -a` 查看状态。等 MySQL 和 RustFS 就绪，迁移和系统种子任务成功退出后，再启动宿主机上的 API 和 Worker。若已自行提供 MySQL 与 S3 兼容存储，配置连接后按[后端维护说明](../../../backend/README.md)运行迁移与系统种子。

更新代码后重跑 Compose 初始化命令时保留 `--build`。若迁移报 `Can't locate revision identified by ...`，检查当前代码是否包含对应 revision，并核对初始化镜像的代码版本。若缺少 revision，切换到包含该 revision 的代码再操作。保留数据库卷及版本标记。

若调整 Compose 的 MySQL 或 RustFS 凭据、宿主端口或存储桶名称，同步修改后端环境。宿主机进程使用映射端口，Compose 容器仍通过内部服务名和端口通信。改完环境后重启 API 和 Worker。配置字段见[环境变量](../reference/env.md)。

## 启动后端

```bash
cd backend
uv sync
uv run python -m app.dev api
```

## 启动任务 Worker

在另一个终端中启动独立任务进程：

```bash
cd backend
uv run python -m app.dev worker
```

`uvicorn --reload` 只重载 API 进程，不重载 Worker。修改任务执行、模型输出解析或生成校验代码后，确认没有排队或运行中的任务，再停止并重新启动 Worker；同一数据库只运行一个调度 Worker。否则可能出现旧 Worker 将结果标为成功，而新 API 在应用时拒绝结果的情况。重启不会重写已完成任务的结果。

以上开发入口适用于 macOS/Linux，API 保留自动重载，重载时最多等待旧 HTTP 连接 5 秒，随后关闭尚未结束的 SSE 等请求，避免浏览器长连接阻塞新进程启动；独立 Worker 的生成任务不受这一 HTTP 等待时限影响。可用 `api --host 127.0.0.1 --port 8000` 指定监听地址。切换到开发入口前先停止原来直接启动的 API／Worker。原始 `uvicorn` 和 `python -m app.task_worker` 命令仍可用于部署；未设置 `JELLYFISH_DEV_RUNTIME_DIR` 时不登记开发身份。

## 核对进程与代码版本

```bash
cd backend
uv run python -m app.dev status
```

命令显示实际 API 子进程和 Worker 的 PID、上海时区启动时间、Git 修订及代码指纹。指纹包含 `app/**/*.py`、`pyproject.toml` 和 `uv.lock`，因此也能识别未提交修改。`current` 表示存活 PID 持有角色锁且登记代码与工作区一致，`stale` 表示待重启，`stopped` 表示登记进程已退出或角色锁已释放；`unregistered`／`unreadable` 表示身份不可核实，不能据此推断服务未运行。Git 修订不同但内容指纹相同不标为过期。

启动与停止身份写入已忽略的 `backend/.dev-runtime/processes.jsonl`；该文件不包含数据库凭据、提示词或模型正文，应用运行日志仍输出到原终端。登记信息会在实际 API 重载后更新。同目录的角色锁阻止重复启动已登记的同角色进程，但不能识别此前未登记的旧进程，也不替代“同一数据库只运行一个 Worker”的要求。`status` 只读检查，不自动重启或中断任务。

## 按任务 ID 只读诊断

```bash
cd backend
uv run python -m app.dev task <task_id>
```

命令使用 `backend/.env` 配置的数据库，只执行 SELECT；不会初始化数据库、提交事务或重新生成。输出实际连接的数据库类型／位置、任务状态、执行 Worker 身份、上海时区时间、错误摘要、设计契约标志，以及诊断是否存在、问题列表和模型正文字符数。默认不输出模型正文、冻结输入或供应商凭据；完整设计正文仍从场次业务页查看。

退出码：`0` 为查询成功，`1` 为当前数据库未找到任务，`2` 为连接、查询或命令参数错误。数据库错误仅显示异常类型和排查方向，不展开连接串；请同时检查配置、迁移、数据库可达性及当前终端／沙箱的权限，不能把一次连接失败直接判定为数据库停止。

## 启动前端

```bash
cd front
pnpm install
pnpm dev
```

## 默认端口

- Vite 前端：`http://localhost:5173`。若 Vite 改用其他端口，同步调整后端允许的前端来源。
- 后端：`http://localhost:8000`
- Swagger：`http://localhost:8000/docs`

## 联调检查

确认 API 的 `/health` 返回成功、`/docs` 可打开，前端项目列表能加载。通过 `uv run python -m app.dev status` 核对本工作区的 API 和 Worker。修改接口契约时，按 [OpenAPI 同步指南](openapi.md)更新前端客户端。

从仓库根目录运行前端基础检查：

```bash
pnpm --dir front run typecheck
```
