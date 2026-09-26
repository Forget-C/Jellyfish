"""正式库快照与「测试前后是否被改」的判定（防回归）。

为什么需要它
------------
隔离层（``tests/_db_isolation.py``）保证测试进程**默认只连临时库**，但「保证」需要
可证伪的证据：万一哪天隔离被绕过（有人加了新的 ``.env`` 读取路径、有人手动设了
``DATABASE_URL``），必须在整次测试跑完时**立刻发现**，而不是等到生产数据被污染。
所以本模块在会话开始/结束各取一次正式库快照并逐项比对。

快照口径（**重要**，别改错）
------------------------------
1. **文件指纹**：直接读文件字节算 ``sha256``，同时记 ``size`` / ``mtime_ns``。
   不打开 SQLite 去算（避免任何打开动作影响被测库）。
2. **同目录的 ``-wal`` 一并纳入指纹**：正式库开着 WAL，写入会先落在 ``-wal`` 上，
   只比主库文件会漏掉「还没 checkpoint 的写入」。
3. **``-shm`` 只记录、不参与判定**：``-shm`` 是共享内存索引，别的进程（例如本机
   正在跑的 uvicorn / worker）一打开正式库就可能刷新它的 ``mtime``，拿它当判据会
   造成假警报。它的信息仍然打印出来，供人工核对。
4. **业务表行数快照**：以**只读**方式（``file:…?mode=ro``）打开正式库，统计库内
   每张表的行数。这是与文件哈希互补的第二重证据（哈希对「内容相同但重写了文件」
   敏感，行数对「数据被改」直观）。
5. 判定规则：``size`` / ``mtime_ns`` / ``sha256``（主库 + ``-wal``）或任一行数
   不一致 → 判为「有变化」，由 ``tests/conftest.py`` 在会话结束时大声报错并把整次
   测试运行置为非零码。读不到行数（例如库被独占、``-wal`` 没有 ``-shm``）时**只**
   退化为文件指纹比对，并在输出里说明，绝不静默放过。

本模块**只读**正式库：不建连接以外的动作，不写、不迁移、不删。
"""

from __future__ import annotations

import hashlib
import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

#: 防回归至少要盯住的业务表（用户明确点名的清单）。
BUSINESS_TABLES: tuple[str, ...] = (
    "projects",
    "chapters",
    "shots",
    "generation_tasks",
    "files",
    "characters",
    "scenes",
    "props",
    "costumes",
)

_CHUNK = 1 << 20


@dataclass(frozen=True)
class FileFingerprint:
    """单个文件（或「不存在」）的指纹。"""

    path: str
    exists: bool
    size: int | None = None
    mtime_ns: int | None = None
    sha256: str | None = None

    def describe(self) -> str:
        if not self.exists:
            return f"{self.path}（不存在）"
        return f"{self.path}（size={self.size} sha256={(self.sha256 or '')[:12]}）"


def fingerprint_file(path: Path) -> FileFingerprint:
    """读文件字节算指纹；文件不存在时返回 ``exists=False`` 的指纹。纯只读。"""
    target = Path(path)
    try:
        stat = target.stat()
    except OSError:
        return FileFingerprint(path=str(target), exists=False)
    digest = hashlib.sha256()
    try:
        with target.open("rb") as handle:
            for chunk in iter(lambda: handle.read(_CHUNK), b""):
                digest.update(chunk)
    except OSError:
        # 读不到内容（权限之类）：只记 size/mtime，sha256 留空 → 判定时按「不可比」处理。
        return FileFingerprint(
            path=str(target), exists=True, size=stat.st_size, mtime_ns=stat.st_mtime_ns, sha256=None
        )
    return FileFingerprint(
        path=str(target),
        exists=True,
        size=stat.st_size,
        mtime_ns=stat.st_mtime_ns,
        sha256=digest.hexdigest(),
    )


@dataclass(frozen=True)
class DatabaseSnapshot:
    """一个数据库在某一时刻的快照。"""

    path: str
    taken_at: str
    main: FileFingerprint
    wal: FileFingerprint
    #: 只记录不参与判定的共享内存文件
    shm: FileFingerprint | None = None
    #: 表名 → 行数；拿不到时是空字典，原因见 ``row_counts_error``
    row_counts: dict[str, int] = field(default_factory=dict)
    row_counts_error: str | None = None

    def describe(self) -> str:
        tables = f"{len(self.row_counts)} 张表" if self.row_counts else "行数不可用"
        return f"{self.path}｜主库 {self.main.describe()}｜{tables}"


def table_names(db_path: Path) -> list[str]:
    """库内全部用户表（不含 ``sqlite_*`` 内部表），只读。"""
    connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        rows = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
        ).fetchall()
    finally:
        connection.close()
    return [str(row[0]) for row in rows if not str(row[0]).startswith("sqlite_")]


def read_row_counts(db_path: Path) -> tuple[dict[str, int], str | None]:
    """只读统计每张表的行数。

    返回 ``(计数, 失败原因)``；失败时计数为空、原因写清中文，调用方据此降级为
    「只比文件指纹」而不是判成「没变化」。
    """
    if not Path(db_path).exists():
        return {}, f"库文件不存在：{db_path}"
    counts: dict[str, int] = {}
    try:
        connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            names = [
                str(row[0])
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
                ).fetchall()
                if not str(row[0]).startswith("sqlite_")
            ]
            for name in names:
                query = f'SELECT COUNT(*) FROM "{name}"'
                counts[name] = int(connection.execute(query).fetchone()[0])
        finally:
            connection.close()
    except sqlite3.Error as exc:  # pragma: no cover - 依赖本机文件状态
        return {}, f"只读统计失败（{exc.__class__.__name__}: {exc}）"
    return counts, None


def take_snapshot(db_path: Path) -> DatabaseSnapshot:
    """取一次快照：主库 + ``-wal`` 指纹、``-shm`` 记录、全表行数。全程只读。"""
    target = Path(db_path)
    rows, error = read_row_counts(target)
    return DatabaseSnapshot(
        path=str(target),
        taken_at=datetime.now().isoformat(timespec="seconds"),
        main=fingerprint_file(target),
        wal=fingerprint_file(target.with_name(target.name + "-wal")),
        shm=fingerprint_file(target.with_name(target.name + "-shm")),
        row_counts=rows,
        row_counts_error=error,
    )


def _file_changes(label: str, before: FileFingerprint, after: FileFingerprint) -> list[str]:
    """两个文件指纹的差异（中文描述）；一致返回空列表。"""
    changes: list[str] = []
    if before.exists != after.exists:
        changes.append(f"{label}：存在性变化（{before.exists} → {after.exists}）")
        return changes
    if not before.exists:
        return changes
    for field_name, human in (("size", "大小"), ("sha256", "内容哈希")):
        old = getattr(before, field_name)
        new = getattr(after, field_name)
        if old != new:
            changes.append(f"{label}：{human} {str(old)[:12]} → {str(new)[:12]}")
    if before.mtime_ns != after.mtime_ns:
        changes.append(
            f"{label}：mtime 变化（{before.mtime_ns} → {after.mtime_ns}）"
        )
    return changes


def snapshot_changes(before: DatabaseSnapshot, after: DatabaseSnapshot) -> list[str]:
    """纯函数：两份快照的差异清单；完全相同则返回空列表。

    判定项：主库与 ``-wal`` 的 ``size`` / ``mtime_ns`` / ``sha256``，以及每张表的行数。
    ``-shm`` 不参与判定（见模块 docstring 口径 3）。

    「行数拿不到」不算变化（那是降级，不是证据），但也不会被静默放过：
    :func:`snapshot_degradations` 会把它列出来，由调用方打印醒目提示。
    """
    if before.path != after.path:
        return [f"快照路径不同：{before.path} ≠ {after.path}"]

    changes = _file_changes("主库", before.main, after.main)
    changes += _file_changes("-wal", before.wal, after.wal)

    for name in sorted(set(before.row_counts) | set(after.row_counts)):
        old = before.row_counts.get(name)
        new = after.row_counts.get(name)
        if old != new:
            show_old = "表不存在" if old is None else old
            show_new = "表不存在" if new is None else new
            changes.append(f"表 {name} 行数：{show_old} → {show_new}")
    return changes


def snapshot_degradations(before: DatabaseSnapshot, after: DatabaseSnapshot) -> list[str]:
    """本次比对**没能覆盖**的部分（拿不到行数、读不到哈希），供调用方醒目打印。"""
    notes: list[str] = []
    for label, snapshot in (("会话前", before), ("会话后", after)):
        if snapshot.row_counts_error:
            notes.append(f"{label}拿不到行数快照：{snapshot.row_counts_error}")
        if snapshot.main.exists and snapshot.main.sha256 is None:
            notes.append(f"{label}读不到主库内容哈希：{snapshot.main.path}")
    return notes


def rows_digest(snapshot: DatabaseSnapshot, tables: Iterable[str] = BUSINESS_TABLES) -> str:
    """业务表行数的紧凑摘要，用于一行结论输出。"""
    if not snapshot.row_counts:
        return "行数不可用"
    return " ".join(f"{name}={snapshot.row_counts.get(name, '缺失')}" for name in tables)


def format_change_report(path: str, changes: list[str]) -> str:
    """把差异清单排版成醒目的中文告警。"""
    lines = [f"  ✗ {path}"]
    lines += [f"      - {item}" for item in changes]
    return "\n".join(lines)


__all__ = [
    "BUSINESS_TABLES",
    "DatabaseSnapshot",
    "FileFingerprint",
    "fingerprint_file",
    "format_change_report",
    "read_row_counts",
    "rows_digest",
    "snapshot_changes",
    "snapshot_degradations",
    "table_names",
    "take_snapshot",
]
