"""自检脚本共用的「这次自检用哪个库」解析 + 数据不足时的明确跳过说明。

为什么需要它
------------
``tests/selfcheck_*.py`` 是**手工自检入口**，它们要读一个**有真实数据的** Jellyfish 库
（出口 A 的条数、章节镜头、jurilu 提示词都得真存在）。以前它们硬编码
``backend/jellyfish.db``，于是碰到下面两种情况会喷一堆看不懂的断言失败，
让人误以为代码坏了：

* 库文件不存在 / 是 0 字节（例如在 worktree 里，``jellyfish.db`` 只是个空壳）；
* 库存在但**没有数据**（自检要求「找一个含 jurilu 提示词的章节」这种前置条件）。

现在的口径：
1. 优先 ``JELLYFISH_SELFCHECK_DB``（绝对路径）；
2. 否则从 ``DATABASE_URL`` 里取 sqlite 文件路径 —— 应用读哪个库，自检就读哪个库，
   避免「指纹算的是 A 库、应用读的是 B 库」这种假证据；
3. 否则回退到 ``backend/jellyfish.db``（仓库内的历史默认值）。

拿不到可用库时**不报 FAIL**，而是打印一行中文「跳过」原因并返回 0：
这份输出的含义是「环境数据不足，本次没验证」，而不是「代码有问题」。
"""

from __future__ import annotations

import os
import re
import sqlite3
from pathlib import Path
from typing import Optional

#: 自检必需的表（缺了就说明这不是一个可用的 Jellyfish 库）
_REQUIRED_TABLES = ("chapters", "shots", "shot_details")


def _path_from_database_url(database_url: str, backend_dir: Path) -> Optional[Path]:
    """从 ``DATABASE_URL`` 里取 sqlite 文件路径（相对路径按 ``backend/`` 解析）。

    SQLAlchemy 的写法约定（容易踩）：
      * ``sqlite+aiosqlite:////abs/path.db`` → **绝对**路径 ``/abs/path.db``；
      * ``sqlite+aiosqlite:///rel.db``      → **相对**路径 ``rel.db``（相对进程工作目录）；
      * ``sqlite+aiosqlite:///:memory:``    → 内存库，没有文件可指。
    """
    match = re.match(r"^(?P<scheme>[a-z0-9+]+)://(?P<netloc>[^/]*)(?P<path>/[^?]*)?",
                     database_url, flags=re.IGNORECASE)
    if not match:
        return None
    scheme = match.group("scheme").lower()
    if not scheme.startswith("sqlite"):
        return None
    path = match.group("path") or ""
    if not path or path in {"/:memory:", "/:memory"}:
        return None
    if path.startswith("//"):           # ////abs/path → 绝对
        return Path(path[1:])
    return (backend_dir / path.lstrip("/")).resolve()   # ///rel/path → 相对 backend


def resolve_db_path(backend_dir: Path) -> Path:
    """按上面文档的优先级解析本次自检要用的库路径。"""
    override = str(os.environ.get("JELLYFISH_SELFCHECK_DB") or "").strip()
    if override:
        return Path(override).expanduser()
    database_url = str(os.environ.get("DATABASE_URL") or "").strip()
    if database_url:
        from_url = _path_from_database_url(database_url, backend_dir)
        if from_url is not None:
            return from_url
    return backend_dir / "jellyfish.db"


def unusable_reason(  # pylint: disable=too-many-return-statements
    db_path: Path, *, require_rows: bool = True
) -> Optional[str]:
    """库不可用时返回中文原因；可用返回 ``None``。

    ``require_rows``：自检要读「章节里的镜头」，只有表结构没有数据（例如刚跑完
    ``scripts/init_test_db.py`` 的空库）也算不可用 —— 否则只会喷一串看不懂的断言失败。
    """
    if not db_path.exists():
        return f"找不到数据库文件：{db_path}"
    try:
        if db_path.stat().st_size == 0:
            return f"数据库文件是空的（0 字节）：{db_path}"
    except OSError as exc:  # pragma: no cover - 权限之类
        return f"读不到数据库文件：{db_path}（{exc}）"
    try:
        connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    except sqlite3.Error as exc:
        return f"打不开数据库：{db_path}（{exc}）"
    try:
        rows = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
        tables = {str(row[0]) for row in rows}
        missing = [name for name in _REQUIRED_TABLES if name not in tables]
        if missing:
            return f"库里没有这些表：{'、'.join(missing)}（{db_path}）"
        if require_rows:
            shot_count = connection.execute("SELECT COUNT(*) FROM shots").fetchone()[0]
            if not shot_count:
                return f"库里没有任何镜头（shots 表为空）：{db_path}"
    except sqlite3.Error as exc:
        return f"读不到库结构：{db_path}（{exc}）"
    finally:
        connection.close()
    return None


def skip_note(db_path: Path, reason: str) -> str:
    """统一的「跳过」提示，提醒怎么让自检真正跑起来。"""
    return (
        f"跳过：{reason}\n"
        "  自检需要一个**有数据的** Jellyfish 库（章节 / 镜头 / jurilu 提示词都要真存在）。\n"
        "  指向别的库请设 JELLYFISH_SELFCHECK_DB=/绝对路径/xxx.db，"
        "并让 DATABASE_URL 指向同一个库。"
    )


__all__ = ["resolve_db_path", "skip_note", "unusable_reason"]
