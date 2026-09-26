#!/usr/bin/env bash
#
# 本地启动后端：默认「演练模式」，显式确认后可开「真实模式」。
#
# 用法：
#   bash backend/scripts/run_backend.sh --status          # 只打印当前 shell 里的模式判定，不启动
#   bash backend/scripts/run_backend.sh                   # 演练模式启动（默认，零费用）
#   bash backend/scripts/run_backend.sh --real            # 真实模式启动（需要按提示确认一次）
#   bash backend/scripts/run_backend.sh --real --yes      # 非交互环境（CI/脚本）用
#   PORT=8001 bash backend/scripts/run_backend.sh         # 换端口
#
# 这个脚本只做三件事：设好两个守卫环境变量 → 回显当前模式 → exec uvicorn。
# 它不改变仓库原有的启动方式（`uv run uvicorn app.main:app --reload` 依然可用），
# 存在的意义是：不必猜环境变量名，并且用**进程环境变量**压住 backend/.env 里可能
# 残留的开关（守卫的优先级是「进程环境变量 > .env > 默认值」，所以这里的 export
# 一定赢；演练模式启动时脚本会显式 export JELLYFISH_DRY_RUN=1 并 unset 确认变量）。
#
# 完整说明见 docs/real-run-mode.md。
#
# 注：`--status` 只读**环境变量**这一侧，看不到 `.env` 里写了什么；要看最终生效结果，
# 用状态接口的 data.switch_source / data.dotenv_real_mode，或启动时的告警日志。

set -euo pipefail

DRY_RUN_ENV="JELLYFISH_DRY_RUN"
CONFIRM_ENV="JELLYFISH_REAL_LLM_CONFIRMED"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"

MODE="dry-run"
ASSUME_YES="no"

usage() {
  sed -n '3,21p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --real) MODE="real" ;;
    --dry-run) MODE="dry-run" ;;
    --yes|-y) ASSUME_YES="yes" ;;
    --status) MODE="status" ;;
    -h|--help) usage 0 ;;
    *) echo "未知参数：$1" >&2; usage 1 ;;
  esac
  shift
done

print_mode() {
  local dry_run_label confirm_label
  if [ -z "${!DRY_RUN_ENV:-}" ]; then
    dry_run_label="未设置（按开启处理）"
  else
    dry_run_label="${!DRY_RUN_ENV}"
  fi
  if [ -z "${!CONFIRM_ENV:-}" ]; then
    confirm_label="未设置"
  else
    confirm_label="${!CONFIRM_ENV}"
  fi
  echo "守卫环境变量：${DRY_RUN_ENV}=${dry_run_label}　${CONFIRM_ENV}=${confirm_label}"
  # .env 里的同类开关**也生效**（优先级低于进程环境变量）。这里显式点出来，
  # 免得只看环境变量就以为「已经关回演练了」。
  if [ -f "${BACKEND_DIR}/.env" ] \
    && grep -qE "^[[:space:]]*(${DRY_RUN_ENV}|${CONFIRM_ENV})[[:space:]]*=" "${BACKEND_DIR}/.env"; then
    echo "⚠️  ${BACKEND_DIR}/.env 里也写了这两个开关（优先级低于上面的环境变量）："
    grep -nE "^[[:space:]]*(${DRY_RUN_ENV}|${CONFIRM_ENV})[[:space:]]*=" "${BACKEND_DIR}/.env" \
      | sed 's/^/    .env:/'
    echo "    → 只关环境变量不够，要一并改掉/删掉 .env 里的那两行。"
  fi
  echo "验证当前模式：curl -s http://localhost:${PORT}/api/v1/studio/llm/orchestration/status"
  echo "                （看 data.mode 与 data.switch_source：env / dotenv / default）"
  echo "说明文档：docs/real-run-mode.md"
}

if [ "${MODE}" = "status" ]; then
  echo "—— 只读模式判定（不启动服务）——"
  print_mode
  exit 0
fi

if [ "${MODE}" = "real" ]; then
  cat <<'WARN'
============================================================
  真实模式：接下来的调用会产生**真实费用**（大模型按 token、
  出图按张、出视频按次、对象存储按存储与流量）。
  调用前的确认弹窗、批量上限、去重幂等**依然生效**。
  用完请 Ctrl+C 后改用：bash backend/scripts/run_backend.sh
============================================================
WARN
  if [ "${ASSUME_YES}" != "yes" ]; then
    printf '确认开启真实模式？输入 yes 继续：'
    read -r answer
    if [ "${answer}" != "yes" ]; then
      echo "已取消：未开启真实模式。" >&2
      exit 1
    fi
  fi
  export "${DRY_RUN_ENV}=0"
  export "${CONFIRM_ENV}=1"
  echo "—— 真实模式启动 ——"
else
  # 演练模式：显式写 1，并清掉可能残留的确认变量
  export "${DRY_RUN_ENV}=1"
  unset "${CONFIRM_ENV}" || true
  echo "—— 演练模式启动（默认，不会产生任何费用）——"
fi

print_mode
cd "${BACKEND_DIR}"
echo "启动命令：uv run uvicorn app.main:app --reload --host ${HOST} --port ${PORT}"
exec uv run uvicorn app.main:app --reload --host "${HOST}" --port "${PORT}"
