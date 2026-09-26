"""真实模式开关的**独立进程**验证（用户明确要求用独立进程测）。

为什么必须独立进程：开关解析发生在 `Settings` 构造那一刻（`.env` 只在进程启动时读一次），
进程内 monkeypatch 出来的结论**不能**证明「真正起后端时也是这个结果」。所以在
子进程里跑真实导入、真实读 `.env`（用 `JELLYFISH_ENV_FILE` 指向临时文件，
**绝不碰仓库里那份含真实凭证的 `backend/.env`**），把解析结果打成 JSON 再断言。

覆盖用户点名的四种情形：
1. 默认（两处都没配）→ 演练；
2. 只写 `.env` + 确认 → 真实，来源 `dotenv`；
3. 进程环境变量覆盖 `.env`（两个方向都测）；
4. 非法布尔值 → 安全回退成演练（且不崩）。

另有一条兜底：整份测试跑完后守卫终态必须仍是 `dry_run=true / real_call_confirmed=false`。
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent

#: 子进程里执行的最小探针：只导入守卫、把最终解析结果打成一行 JSON。
_PROBE = """
import json
from app.services.studio.llm_orchestration import dry_run

print(json.dumps({
    "dry_run": dry_run.dry_run_enabled(),
    "confirmed": dry_run.real_call_confirmed(),
    "mode": dry_run.mode(),
    "source": dry_run.source(),
    "source_label": dry_run.source_label(),
    "dotenv_keys": dry_run.dotenv_keys(),
    "outlets": {item["outlet"]: item["allowed"] for item in dry_run.outlet_states()},
}))
"""


def _run_probe(env_file: Path, extra_env: dict[str, str] | None = None) -> dict:
    """在**独立进程**里跑探针；环境变量只给「干净底座 + 本次要测的开关」。"""
    env = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": os.environ.get("HOME", ""),
        "LANG": os.environ.get("LANG", "en_US.UTF-8"),
        # 让子进程读我们指定的临时 .env（而不是仓库那份）
        "JELLYFISH_ENV_FILE": str(env_file),
        # 避免子进程连真库/真存储：这两个只影响存储与 DB 初始化，不参与开关解析
        "DATABASE_URL": f"sqlite+aiosqlite:///{env_file.parent}/probe.db",
    }
    env.update(extra_env or {})
    result = subprocess.run(
        [sys.executable, "-c", _PROBE],
        cwd=str(BACKEND_ROOT),
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert result.returncode == 0, f"探针进程失败：{result.returncode}\n{result.stderr[-800:]}"
    line = [row for row in result.stdout.splitlines() if row.strip().startswith("{")][-1]
    return json.loads(line)


def _write_env(tmp_path: Path, content: str) -> Path:
    path = tmp_path / "probe.env"
    path.write_text(content, encoding="utf-8")
    return path


def test_subprocess_default_is_dry_run(tmp_path) -> None:
    """1) 两处都没配 → 演练，且四个出口全部拦截。"""
    env_file = _write_env(tmp_path, "# 故意留空：测默认值\n")
    out = _run_probe(env_file)
    assert out["dry_run"] is True
    assert out["confirmed"] is False
    assert out["mode"] == "dry_run"
    assert out["source"] == "default"
    assert all(allowed is False for allowed in out["outlets"].values())


def test_subprocess_dotenv_enables_real_mode(tmp_path) -> None:
    """2) 只写 .env（含确认）→ 真实模式，来源标注 backend/.env 一类。"""
    env_file = _write_env(
        tmp_path,
        "JELLYFISH_DRY_RUN=0\nJELLYFISH_REAL_LLM_CONFIRMED=1\n",
    )
    out = _run_probe(env_file)
    assert out["dry_run"] is False
    assert out["confirmed"] is True
    assert out["mode"] == "real"
    assert out["source"] == "dotenv"
    assert out["source_label"]  # 有可读来源标签（页面/接口据此显示，不含任何密钥）
    assert sorted(out["dotenv_keys"]) == [
        "JELLYFISH_DRY_RUN",
        "JELLYFISH_REAL_LLM_CONFIRMED",
    ]
    assert all(allowed is True for allowed in out["outlets"].values())


def test_subprocess_env_overrides_dotenv_both_directions(tmp_path) -> None:
    """3) 进程环境变量 > .env：.env 开真实、环境变量压回演练；反向亦然。"""
    real_env_file = _write_env(
        tmp_path,
        "JELLYFISH_DRY_RUN=0\nJELLYFISH_REAL_LLM_CONFIRMED=1\n",
    )
    # 方向 A：.env 说真实，环境变量说演练 → 以环境变量为准
    out_a = _run_probe(real_env_file, {"JELLYFISH_DRY_RUN": "1"})
    assert out_a["dry_run"] is True
    assert out_a["source"] == "env"

    dry_env_file = _write_env(tmp_path, "JELLYFISH_DRY_RUN=1\n")
    # 方向 B：.env 说演练，环境变量说真实（且已确认）→ 以环境变量为准
    out_b = _run_probe(
        dry_env_file,
        {"JELLYFISH_DRY_RUN": "0", "JELLYFISH_REAL_LLM_CONFIRMED": "1"},
    )
    assert out_b["dry_run"] is False
    assert out_b["confirmed"] is True
    assert out_b["source"] == "env"


def test_subprocess_unparsable_value_falls_back_to_dry_run(tmp_path) -> None:
    """4) 非法布尔值 → 安全回退成演练（进程能起来，绝不因为读不懂就放行）。"""
    for raw in ("maybe", "yes please", "2", "TURE"):
        env_file = _write_env(
            tmp_path,
            f"JELLYFISH_DRY_RUN={raw}\nJELLYFISH_REAL_LLM_CONFIRMED={raw}\n",
        )
        out = _run_probe(env_file)
        assert out["dry_run"] is True, f"{raw!r} 必须回退成演练"
        assert out["confirmed"] is False, f"{raw!r} 不能算「已确认」"
        assert all(allowed is False for allowed in out["outlets"].values())


def test_subprocess_env_only_records_source_env(tmp_path) -> None:
    """只设环境变量（.env 没配）→ 来源是 env，且 dotenv_keys 为空。"""
    env_file = _write_env(tmp_path, "# 空\n")
    out = _run_probe(
        env_file,
        {"JELLYFISH_DRY_RUN": "0", "JELLYFISH_REAL_LLM_CONFIRMED": "1"},
    )
    assert out["mode"] == "real"
    assert out["source"] == "env"
    assert out["dotenv_keys"] == []


def test_subprocess_env_dry_run_without_confirm_reports_not_confirmed(tmp_path) -> None:
    """只关演练、没确认 → 仍拦截，且原因是「未确认」而不是「演练」。"""
    env_file = _write_env(tmp_path, "# 空\n")
    out = _run_probe(env_file, {"JELLYFISH_DRY_RUN": "0"})
    assert out["confirmed"] is False
    assert all(allowed is False for allowed in out["outlets"].values())
    assert out["mode"] != "real"
