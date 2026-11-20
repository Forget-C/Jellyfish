"""分类资产图片的用途、展示默认值与确定性参考图说明。"""

from fastapi import HTTPException

from app.core import storage
from app.core.contracts.asset_prompts import AssetPromptReference
from app.models.studio import FileItem, FileType

ASSET_TEMPLATE = """用途：{{ purpose }}
主体名称：{{ name }}
主体设定（保留已确认特征，不擅自补充身份信息）：
{{ description }}
画面表现：{{ visual_style }}；题材：{{ style }}。
视角：{{ view_angle }}。
{{ framing_instruction }}
{{ background_instruction }}
{{ lighting_instruction }}
{{ visible_detail_instruction }}
{{ reference_instruction }}
仅应用与主体设定及当前视角一致的本次展示要求：{{ additional_instruction }}
排除：{{ negative_prompt }}"""

PURPOSES = {
    "actor": "单人可复用身份设定图，保持年龄、五官、体型、肤色和发型；中性展示着装。",
    "character": "角色设定图，以当前角色自身设定为准；主体、服装与道具图片提供明确的视觉参考。",
    "scene": "场景空间设定图，清楚展示固定布局、环境和材质。",
    "prop": "单一道具设计展示图，完整展示轮廓、结构、比例和材质。",
    "costume": "服装设计展示图，用无脸人台展示完整款式、层次、纹样和材质。",
}

DISPLAY_DEFAULTS = {
    "framing_instruction": "主体完整、清晰可见，构图居中。",
    "background_instruction": "干净中性背景。",
    "lighting_instruction": "均匀柔和照明，准确呈现颜色与材质。",
    "visible_detail_instruction": "仅展示当前视角可见的特征，不为展示被遮挡细节改变视角。",
    "negative_prompt": "非用户要求的文字、水印、标志及额外主体。",
}

ROLE_INSTRUCTIONS = {
    "identity": "身份参考：保持同一人物的年龄、脸型、五官、肤色、体型和发型，不继承参考图中的服装或背景。",
    "costume": "服装参考：保持款式、层次、材质、颜色和纹样，不继承人台或模特身份。",
    "prop": "道具参考：保持轮廓、结构、尺度关系、材质和颜色。",
    "layout": "场景布局参考：保持空间关系、固定环境和主要材质。",
    "style": "画风参考：仅参考画面表现，不复制参考图的主体或构图。",
    "design": "设计参考：保持主体结构、比例、材质和颜色。",
}


async def resolve_prompt_references(db, references: list[AssetPromptReference]) -> tuple[list[str], str]:
    """按最终输入去重、保留用途并检查文件，再按同一顺序生成引用说明。"""
    roles_by_file: dict[str, list[str]] = {}
    for ref in references:
        roles = roles_by_file.setdefault(ref.file_id, [])
        if ref.role not in roles:
            roles.append(ref.role)
    for file_id in roles_by_file:
        file = await db.get(FileItem, file_id)
        if file is None or file.type != FileType.image or not file.storage_key:
            raise HTTPException(status_code=400, detail=f"参考图不可用：{file_id}")
        try:
            await storage.get_file_info(key=file.storage_key)
        except Exception as error:
            raise HTTPException(status_code=400, detail=f"参考图文件无法访问：{file_id}") from error
    instructions = [
        f"图 {index}：" + " ".join(ROLE_INSTRUCTIONS[role] for role in roles)
        for index, roles in enumerate(roles_by_file.values(), 1)
    ]
    return list(roles_by_file), "\n".join(instructions)
