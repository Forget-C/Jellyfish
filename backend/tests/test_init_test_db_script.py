"""`scripts/init_test_db.py` 的安全防护回归测试。

这个脚本会写假供应商 / 假模型 / 改默认模型设置，所以必须保证它**只能**作用在
一个全新的临时库上。本文件覆盖四类防护：

1. 新的临时库可以正常初始化；
2. 已存在的库被拒绝，且原文件内容一字不变；
3. `jellyfish.db` 这一名称（以及正式库路径、仓库内路径）被拒绝；
4. **拒绝发生在任何写操作之前**：不建表、不写供应商、不改默认模型设置。

测试只使用 pytest 的 `tmp_path`，不触碰 `backend/jellyfish.db`，也不发起任何网络调用。
"""

from __future__ import annotations

import hashlib
import importlib.util
import sqlite3
import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = BACKEND_ROOT / "scripts" / "init_test_db.py"


def _load_script_module():
    """按文件路径加载脚本模块（scripts/ 不是包，直接 import 拿不到）。"""
    if str(BACKEND_ROOT) not in sys.path:
        sys.path.insert(0, str(BACKEND_ROOT))
    spec = importlib.util.spec_from_file_location("init_test_db_script", SCRIPT_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


script = _load_script_module()


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _table_names(db_path: Path) -> set[str]:
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    return {row[0] for row in rows}


def _make_existing_db(path: Path) -> None:
    """造一个「像正式库」的既有库：有标记表 + 一条标记供应商。"""
    with sqlite3.connect(path) as conn:
        conn.execute("CREATE TABLE marker (id INTEGER PRIMARY KEY, note TEXT)")
        conn.execute("INSERT INTO marker (id, note) VALUES (1, 'pre-existing')")
        conn.execute("CREATE TABLE providers (id TEXT PRIMARY KEY, name TEXT)")
        conn.execute("INSERT INTO providers (id, name) VALUES ('prov-real', '正式供应商')")
        conn.commit()


def _assert_untouched(path: Path, digest_before: str) -> None:
    """拒绝之后：文件字节完全一致，且没有多出任何表 / 供应商。"""
    assert path.exists(), "既有文件不应被删除"
    assert _sha256(path) == digest_before, "既有数据库内容发生了变化"
    with sqlite3.connect(path) as conn:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        providers = [row[0] for row in conn.execute("SELECT id FROM providers").fetchall()]
    assert tables == {"marker", "providers"}, f"多出了表：{tables}"
    assert providers == ["prov-real"], "供应商被改写或追加"


# --------------------------------------------------------------- 1. 正常初始化


def test_new_temp_db_can_be_initialized(tmp_path: Path) -> None:
    """全新的临时库可以正常建表并写入配置种子。"""
    target = tmp_path / "fresh" / "test.db"
    assert not target.exists()

    exit_code = script.main([str(target)])

    assert exit_code == 0
    assert target.exists()
    tables = _table_names(target)
    assert "providers" in tables and "models" in tables and "model_settings" in tables
    assert len(tables) == len(script.Base.metadata.tables)

    with sqlite3.connect(target) as conn:
        provider_ids = sorted(row[0] for row in conn.execute("SELECT id FROM providers").fetchall())
        model_ids = sorted(row[0] for row in conn.execute("SELECT id FROM models").fetchall())
        defaults = conn.execute(
            "SELECT default_text_model_id, default_image_model_id, default_video_model_id FROM model_settings WHERE id = 1"
        ).fetchone()
    assert provider_ids == sorted(spec["id"] for spec in script.PROVIDERS)
    assert model_ids == sorted(model_id for model_id, *_ in script.MODELS)
    assert defaults == ("model-deepseek-chat", "model-gpt-image-2", "model-seedance-2.0-mini")


def test_init_is_rejected_when_run_twice(tmp_path: Path) -> None:
    """跑第二次时目标已存在 → 拒绝（不覆盖、不删除、不改名备份）。"""
    target = tmp_path / "twice.db"
    assert script.main([str(target)]) == 0
    digest = _sha256(target)

    exit_code = script.main([str(target)])

    assert exit_code == 2
    assert _sha256(target) == digest


# --------------------------------------------------------------- 2. 既有库被拒绝


def test_existing_db_is_refused_and_content_unchanged(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """目标已存在（哪怕它是个像样的正式库）→ 拒绝执行，原文件内容不变。"""
    target = tmp_path / "existing.db"
    _make_existing_db(target)
    digest = _sha256(target)

    exit_code = script.main([str(target)])
    captured = capsys.readouterr()

    assert exit_code == 2
    assert "拒绝已存在的目标" in captured.err
    _assert_untouched(target, digest)


# --------------------------------------------------------------- 3. 正式库 / 仓库路径被拒绝


def test_jellyfish_db_name_is_refused_anywhere(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """以 jellyfish.db 命名的目标一律拒绝，且**不会创建**这个文件。"""
    target = tmp_path / "jellyfish.db"
    assert not target.exists()

    exit_code = script.main([str(target)])
    captured = capsys.readouterr()

    assert exit_code == 2
    assert "拒绝以 jellyfish.db 命名" in captured.err
    assert not target.exists(), "被拒绝的目标不应被创建"


def test_production_db_path_is_refused(capsys: pytest.CaptureFixture[str]) -> None:
    """仓库内的正式库路径 backend/jellyfish.db 一律拒绝。"""
    production = BACKEND_ROOT / "jellyfish.db"

    exit_code = script.main([str(production)])
    captured = capsys.readouterr()

    assert exit_code == 2
    assert "拒绝" in captured.err
    assert exit_code != 0


def test_path_inside_repo_is_refused(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """仓库工作树内的路径（即使不叫 jellyfish.db）也拒绝：测试库不该写在仓库里。"""
    target = BACKEND_ROOT / "scripts" / "_tmp_should_not_exist.db"

    exit_code = script.main([str(target)])
    captured = capsys.readouterr()

    assert exit_code == 2
    assert "拒绝仓库工作树内的路径" in captured.err
    assert not target.exists()


def test_empty_target_is_refused(capsys: pytest.CaptureFixture[str]) -> None:
    """没给路径 → 只打印用法，返回 2。"""
    exit_code = script.main([])
    captured = capsys.readouterr()
    assert exit_code == 2
    assert "init_test_db.py" in captured.out


# --------------------------------------------------------------- 4. 拒绝前不写任何东西


def test_refusal_happens_before_any_write(tmp_path: Path) -> None:
    """拒绝路径上不得建表、不得写供应商、不得改默认模型设置。

    用一个「已经初始化过」的库做对照：它的表集合、供应商集合与默认模型必须原样保留。
    """
    target = tmp_path / "already_seeded.db"
    assert script.main([str(target)]) == 0

    with sqlite3.connect(target) as conn:
        conn.execute("UPDATE providers SET name = '被人改过的名字' WHERE id = 'prov-apimart'")
        conn.execute("UPDATE model_settings SET default_text_model_id = 'model-user-choice' WHERE id = 1")
        conn.commit()

    tables_before = _table_names(target)
    digest = _sha256(target)
    with sqlite3.connect(target) as conn:
        providers_before = sorted(row[0] for row in conn.execute("SELECT id FROM providers").fetchall())

    exit_code = script.main([str(target)])

    assert exit_code == 2
    assert _sha256(target) == digest
    assert _table_names(target) == tables_before
    with sqlite3.connect(target) as conn:
        providers_after = sorted(row[0] for row in conn.execute("SELECT id FROM providers").fetchall())
        default_text = conn.execute("SELECT default_text_model_id FROM model_settings WHERE id = 1").fetchone()[0]
        renamed = conn.execute("SELECT name FROM providers WHERE id = 'prov-apimart'").fetchone()[0]
    assert providers_after == providers_before
    # 用户自己的默认模型选择没有被脚本改回种子值
    assert default_text == "model-user-choice"
    assert renamed == "被人改过的名字"


def test_resolve_safe_target_is_pure(tmp_path: Path) -> None:
    """校验函数本身不产生副作用：对已存在路径只抛错，不去动它。"""
    target = tmp_path / "pure.db"
    _make_existing_db(target)
    digest = _sha256(target)

    with pytest.raises(script.UnsafeTargetError):
        script.resolve_safe_target(target)

    _assert_untouched(target, digest)
