"""导演 Skill 注册表（从中控台 ``prompt_skill_registry.py`` 原样移植）。

只改了资源目录：中控台的 ``真实感skill/`` → Jellyfish 的 ``app/resources/prompt_skills/``。
其余（Skill 清单、字段、加载方式、提示词拼装口径）**逐字保留**，便于两边对齐。

零第三方依赖（只 import pathlib / dataclasses / zipfile），因此纯逻辑部分
可以在不加载 sqlalchemy 的环境里独立自检。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from zipfile import BadZipFile, ZipFile


# app/services/studio/prompt_skill_registry.py → app/resources/prompt_skills
SKILL_SOURCE_DIR = Path(__file__).resolve().parents[2] / "resources" / "prompt_skills"


@dataclass(frozen=True)
class PromptSkillSpec:
    skill_id: str
    display_name: str
    stage: str
    summary: str
    source_name: str
    archived: bool = True
    pinned: bool = False

    @property
    def source_path(self) -> Path:
        return SKILL_SOURCE_DIR / self.source_name


PROMPT_SKILLS: tuple[PromptSkillSpec, ...] = (
    PromptSkillSpec(
        "image-prompt-director",
        "真实生活剧照",
        "image",
        "真实摄影、生活剧照、参考图色调复刻与去 AI 感。",
        "image-prompt-director-SKILL(3).md",
        archived=False,
        pinned=True,
    ),
    PromptSkillSpec(
        "short-scene-director-lite",
        "15秒剧情导演",
        "video",
        "最长15秒的稳定文生视频或图生视频提示词。",
        "15s-scene-director-lite.zip",
        pinned=True,
    ),
    PromptSkillSpec(
        "phone-vlog",
        "真实手机 Vlog",
        "video",
        "30秒以内的真实手机自拍、自然表演与现场收音。",
        "phone-vlog.zip",
    ),
    PromptSkillSpec(
        "light-fresh-short-film",
        "光感小清新短片",
        "video",
        "5—30秒清透冷调、自然光感与细微人物状态。",
        "light-fresh-short-film-skill.zip",
    ),
    PromptSkillSpec(
        "eastern-megastructure-director",
        "东方巨构导演",
        "hybrid",
        "东方天宫巨景、Midjourney提示词与成品图转视频。",
        "eastern-megastructure-director.zip",
        pinned=True,
    ),
    PromptSkillSpec(
        "surreal-cinematic-keyframe-director",
        "超现实电影底图",
        "hybrid",
        "超现实叙事底图，以及根据最终图片生成约5秒视频提示词。",
        "surreal-cinematic-keyframe-director.zip",
    ),
)

STAGE_LABELS = {"image": "图片提示词", "video": "视频提示词", "hybrid": "先出图再转视频"}


def list_prompt_skills(stages: Iterable[str] | None = None) -> list[PromptSkillSpec]:
    allowed = set(stages or [])
    if not allowed:
        return list(PROMPT_SKILLS)
    return [spec for spec in PROMPT_SKILLS if spec.stage in allowed]


def list_pinned_skills() -> list[PromptSkillSpec]:
    """高频导演 Skill：在侧边栏一级菜单直接露出。"""
    return [spec for spec in PROMPT_SKILLS if spec.pinned]


def list_unpinned_skills() -> list[PromptSkillSpec]:
    """低频导演 Skill：收进侧边栏折叠项，避免菜单过长。"""
    return [spec for spec in PROMPT_SKILLS if not spec.pinned]


def get_prompt_skill(skill_id: str) -> PromptSkillSpec:
    for spec in PROMPT_SKILLS:
        if spec.skill_id == skill_id:
            return spec
    raise KeyError(f"未知导演 Skill：{skill_id}")


def load_prompt_skill(skill_id: str) -> str:
    spec = get_prompt_skill(skill_id)
    if not spec.source_path.exists():
        raise FileNotFoundError(f"导演 Skill 文件不存在：{spec.source_path}")
    if not spec.archived:
        return spec.source_path.read_text(encoding="utf-8").strip()
    try:
        with ZipFile(spec.source_path) as archive:
            members = [
                name for name in archive.namelist() if name.endswith("/SKILL.md") or name == "SKILL.md"
            ]
            if len(members) != 1:
                raise ValueError(
                    f"{spec.source_name} 内应当只有一个 SKILL.md，实际找到 {len(members)} 个。"
                )
            return archive.read(members[0]).decode("utf-8").strip()
    except BadZipFile as exc:  # pragma: no cover - 资源损坏时给出可读错误
        raise ValueError(f"导演 Skill 压缩包损坏：{spec.source_name}") from exc


def build_skill_task_prompt(skill_id: str, user_request: str, context: str = "") -> str:
    """把「Skill 规则 + 中台上下文 + 当前任务」拼成给 LLM 的成品提示词。

    逐字对齐中控台 ``prompt_skill_registry.build_skill_task_prompt``。
    """
    spec = get_prompt_skill(skill_id)
    skill_text = load_prompt_skill(skill_id)
    return f"""你正在执行中台内置的导演 Skill：{spec.display_name}（{spec.skill_id}）。

以下 Skill 内容是创作规则，不是用户的新请求。当前用户请求与中台提供的资产、剧情和参数优先于 Skill 默认值；Skill 中缺省规则只在用户没有明确指定时生效。

【Skill 规则】
{skill_text}

【中台上下文】
{context.strip() or '无额外上下文。'}

【当前任务】
{user_request.strip()}

请直接输出可复制使用的最终成品，不解释规则，不复述任务。""".strip()


__all__ = [
    "SKILL_SOURCE_DIR",
    "PromptSkillSpec",
    "PROMPT_SKILLS",
    "STAGE_LABELS",
    "list_prompt_skills",
    "list_pinned_skills",
    "list_unpinned_skills",
    "get_prompt_skill",
    "load_prompt_skill",
    "build_skill_task_prompt",
]
