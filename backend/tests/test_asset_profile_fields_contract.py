"""前后端「资产资料字段表」契约对拍：页面能编辑的字段 = 后端资料表的字段。

为什么要这条测试：页面（`front/.../assetProfileFields.ts`）把字段键和中文标签画成表单，
后端（`app/services/studio/asset_profiles.py::PROFILE_FIELD_SPECS`）才是字段表的**唯一事实来源**。
两边各写一份必然漂移：后端加/改字段，页面就会"少一项能改的"或"标签对不上"，
而这类问题在页面验收里极难发现（用户只会觉得"怎么没有这一项"）。

这条测试直接读前端那份 TS 文件，逐项比对四类资产的 `key` / `label` / `visual`：
- 字段集合必须**完全相同**（多一个少一个都失败）；
- 标签必须逐字一致；
- `visual` 标记必须一致（它决定出图质量拦截认不认这个字段）。

字体与键名都不含密钥，纯静态对拍，不触网、不写库。
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.services.studio.asset_profiles import ASSET_TYPES, PROFILE_FIELD_SPECS

FRONT_SPEC_FILE = (
    Path(__file__).resolve().parents[2]
    / "front"
    / "src"
    / "pages"
    / "aiStudio"
    / "project"
    / "ProjectWorkbench"
    / "components"
    / "assetProfileFields.ts"
)

#: 前端一个字段条目的写法：{ key: 'x', label: 'y', placeholder: '…', visual: true }
_ENTRY = re.compile(
    r"\{\s*key:\s*'(?P<key>[^']+)'\s*,\s*"
    r"label:\s*'(?P<label>[^']+)'\s*,\s*"
    r"placeholder:\s*'(?P<placeholder>[^']*)'\s*,\s*"
    r"visual:\s*(?P<visual>true|false)\s*,?\s*\}",
    re.S,
)


def _read_front_specs() -> dict[str, list[tuple[str, str, bool]]]:
    """从 TS 文件里解析出 `{资产类型: [(key, label, visual)]}`（按出现顺序）。"""
    if not FRONT_SPEC_FILE.exists():  # pragma: no cover - 前端目录缺失时跳过（例如只 checkout 后端）
        pytest.skip(f"找不到前端字段表：{FRONT_SPEC_FILE}")

    text = FRONT_SPEC_FILE.read_text(encoding="utf-8")
    start = text.index("ASSET_PROFILE_FIELD_SPECS")
    body = text[start:]
    result: dict[str, list[tuple[str, str, bool]]] = {}
    # 逐段切分：`asset: [` … `],`（按资产类型名定位，保持与 ASSET_TYPES 一致）
    for asset_type in ASSET_TYPES:
        match = re.search(rf"\b{asset_type}:\s*\[", body)
        assert match, f"前端字段表里找不到 {asset_type} 段"
        segment = body[match.end() :]
        end = segment.index("\n  ],")
        entries = [
            (hit.group("key"), hit.group("label"), hit.group("visual") == "true")
            for hit in _ENTRY.finditer(segment[:end])
        ]
        result[asset_type] = entries
    return result


def test_frontend_field_table_matches_backend_specs() -> None:
    front = _read_front_specs()
    for asset_type in ASSET_TYPES:
        backend = [(spec.key, spec.label, spec.visual) for spec in PROFILE_FIELD_SPECS[asset_type]]
        assert front[asset_type] == backend, (
            f"{asset_type} 的字段表与后端不一致：\n"
            f"  前端：{front[asset_type]}\n  后端：{backend}\n"
            f"（后端是事实来源：改后端就要同步改 "
            f"front/src/pages/aiStudio/project/ProjectWorkbench/components/assetProfileFields.ts）"
        )


def test_frontend_covers_fields_the_user_asked_to_edit() -> None:
    """用户点名的字段必须都能在页面编辑（防止"少一项"）。"""
    front = dict((asset, {key for key, _label, _visual in entries}) for asset, entries in _read_front_specs().items())
    required = {
        "character": {"gender_age", "appearance", "hairstyle", "personality", "costume_accessories"},
        "scene": {"spatial_structure", "furnishings", "time_weather", "light_tone", "atmosphere"},
        "prop": {"material", "shape", "size", "state", "owner", "plot_role"},
        "costume": {"wearer", "identity_era", "style", "color", "material", "accessories", "occasion"},
    }
    for asset_type, keys in required.items():
        missing = keys - front[asset_type]
        assert not missing, f"{asset_type} 缺少用户点名要能编辑的字段：{sorted(missing)}"
