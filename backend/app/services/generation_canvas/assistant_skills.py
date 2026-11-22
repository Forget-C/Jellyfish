"""Product-owned creative guidance exposed through two narrowly scoped tools."""

from dataclasses import dataclass
from functools import cache
import json
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


def skill_tools(used: dict[str, CanvasAssistantSkillUse]) -> list:
    """Expose product guidance and track successfully loaded versions for this reply."""
    catalog = skill_catalog()

    @tool
    def load_canvas_skill(skill_id: str) -> str:
        """Load the instructions for a professional skill from the listed canvas skill catalog."""
        if skill_id not in catalog:
            return 'Unknown canvas skill. Choose an identifier from the supplied catalog.'
        skill = catalog[skill_id]
        body = skill.path.read_text(encoding='utf-8').split('---', 2)[2].strip()
        receipt = skill.receipt()
        used[skill_id] = receipt
        return json.dumps({**receipt.model_dump(), 'instructions': body}, ensure_ascii=False)

    @tool
    def read_canvas_skill_example(skill_id: str) -> str:
        """Read the example from a canvas skill already loaded in this turn."""
        if skill_id not in used:
            return 'Load that canvas skill first.'
        return catalog[skill_id].path.with_name('example.md').read_text(encoding='utf-8')

    return [load_canvas_skill, read_canvas_skill_example]
