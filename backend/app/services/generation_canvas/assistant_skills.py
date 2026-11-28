"""Product-owned creative guidance exposed through two narrowly scoped tools."""

from dataclasses import dataclass
from functools import cache
import json
import re
from pathlib import Path

from langchain_core.tools import tool

from app.schemas.canvas_assistant import CanvasAssistantSkillUse

SKILL_ROOT = Path(__file__).resolve().parents[2] / 'assistant_skills'


@dataclass(frozen=True)
class ProductSkill:
    """Metadata read from the front matter without loading the instruction body."""

    path: Path
    id: str
    name: str
    description: str
    version: str

    def instructions(self) -> str:
        """Load this version of the skill from its bundled package."""
        return self.path.read_text(encoding='utf-8').split('---', 2)[2].strip()

    def receipt(self) -> CanvasAssistantSkillUse:
        """Identify the exact product instructions consulted for a turn."""
        return CanvasAssistantSkillUse(id=self.id, name=self.name, version=self.version)


@cache
def skill_catalog() -> dict[str, ProductSkill]:
    """Discover only the skill packages bundled with the application."""
    catalog = {}
    for path in sorted(SKILL_ROOT.glob('*/SKILL.md')):
        with path.open(encoding='utf-8') as source:
            if source.readline().strip() != '---':
                raise ValueError(f'Missing canvas skill front matter in {path.name}')
            metadata = {}
            for line in source:
                if line.strip() == '---':
                    break
                key, value = line.strip().split(':', 1)
                metadata[key] = value.strip()
            else:
                raise ValueError(f'Unclosed canvas skill front matter in {path.name}')
        if path.parent.name != metadata['name']:
            raise ValueError('Canvas skill directory must match its identifier')
        skill = ProductSkill(path, metadata['name'], metadata['title'], metadata['description'], metadata['version'])
        catalog[skill.id] = skill
    return catalog


def skill_guidance() -> str:
    """Advertise available skills without loading their bodies into the model context."""
    entries = '\n'.join(f'- {skill.id}（{skill.name}）: {skill.description}' for skill in skill_catalog().values())
    return (
        '\n用户点名专业角度时按指定角度回答。需要专业建议时先调用 load_canvas_skill，可以组合多项。'
        '只有示例适用于当前问题时才调用 read_canvas_skill_example。回答区分原文事实、已有画布依据和建议新增的拍法，'
        '解释一项叙事或视觉取舍。\n' + entries
    )


def requested_skills(text: str) -> list[ProductSkill]:
    """Resolve slash mentions from the user's message against the bundled catalog."""
    catalog = skill_catalog()
    mentions = dict.fromkeys(re.findall(r'(?<![\w/])/(?P<skill>[a-z][a-z-]*)(?![\w-])', text))
    return [catalog[mention] for mention in mentions if mention in catalog]


def planning_request(text: str) -> bool:
    """Honor explicit read-only planning before making proposal tools available."""
    return re.search(r'(?<![\w/])/plan(?![\w-])', text) is not None or '先给方案' in text


def text_skill_context(text: str, *, planning: bool) -> list[ProductSkill]:
    """Select a narrow evidence-based set of instructions for models without tools."""
    explicit = requested_skills(text)
    if explicit:
        return explicit
    catalog = skill_catalog()
    topics = {
        'script-planning': ('剧本', '方案', '时长', '节奏', '秒'),
        'shot-staging': ('镜头', '分镜', '摄影', '调度', '机位'),
        'image-generation': ('生图', '图片', '首帧'),
        'video-generation': ('生视频', '视频', '运镜'),
        'footage-review': ('审看', '成片', '质量', '粗剪'),
    }
    return [catalog[skill_id] for skill_id, keywords in topics.items()
            if (planning and skill_id == 'script-planning') or any(keyword in text for keyword in keywords)]


def skill_tools(used: dict[str, CanvasAssistantSkillUse], report=None) -> list:
    """Expose product guidance and track successfully loaded versions for this reply."""
    catalog = skill_catalog()

    @tool
    async def load_canvas_skill(skill_id: str) -> str:
        """Load the instructions for a professional skill from the listed canvas skill catalog."""
        if skill_id not in catalog:
            return 'Unknown canvas skill. Choose an identifier from the supplied catalog.'
        skill = catalog[skill_id]
        body = skill.instructions()
        receipt = skill.receipt()
        used[skill_id] = receipt
        if report:
            await report(skills=list(used.values()))
        return json.dumps({**receipt.model_dump(), 'instructions': body}, ensure_ascii=False)

    @tool
    def read_canvas_skill_example(skill_id: str) -> str:
        """Read the example from a canvas skill already loaded in this turn."""
        if skill_id not in used:
            return 'Load that canvas skill first.'
        return catalog[skill_id].path.with_name('example.md').read_text(encoding='utf-8')

    return [load_canvas_skill, read_canvas_skill_example]
