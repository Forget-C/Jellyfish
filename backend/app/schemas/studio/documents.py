"""剧本文档解析的请求/响应模型。"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class DocumentParseRead(BaseModel):
    """文档解析结果（纯文本，不含任何存储地址）。"""

    model_config = ConfigDict(extra="forbid")

    filename: str = Field(..., description="原始文件名")
    format: str = Field(..., description="识别出的格式：txt / md / docx")
    text: str = Field(..., description="解析出的纯文本")
    char_count: int = Field(0, description="字符数")
    paragraph_count: int = Field(0, description="非空段落数")
    warnings: list[str] = Field(default_factory=list, description="解析告警（例如编码不是 UTF-8）")
