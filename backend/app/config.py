"""应用配置，从环境变量加载。"""

import json
from pathlib import Path
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = BACKEND_ROOT / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # App
    app_name: str = "Jellyfish API"
    debug: bool = False

    # API
    api_v1_prefix: str = "/api/v1"

    # Canvas MCP
    mcp_enabled: bool = True
    mcp_secret_key: SecretStr = SecretStr("")

    # Database
    database_url: str = "sqlite+aiosqlite:///./jellyfish.db"

    # CORS：环境变量中建议使用逗号分隔（更贴近 docker-compose 用法）
    # 也兼容 JSON 数组：'["http://a","http://b"]'
    cors_origins: str = "http://localhost:7788,http://127.0.0.1:7788"

    @property
    def cors_origins_list(self) -> list[str]:
        s = (self.cors_origins or "").strip()
        if not s:
            return []
        if s.startswith("["):
            loaded = json.loads(s)
            if isinstance(loaded, list):
                return [str(x).strip() for x in loaded if str(x).strip()]
            return []
        return [x.strip() for x in s.split(",") if x.strip()]

    # S3 / 对象存储（用于素材文件）
    s3_endpoint_url: str | None = None
    s3_region_name: str | None = None
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None
    s3_bucket_name: str | None = None
    # auto：本地/回环 endpoint 使用 path，其余 endpoint 使用 virtual；可按供应商显式覆盖。
    s3_addressing_style: Literal["auto", "path", "virtual"] = "auto"
    # 可选：统一前缀，方便按环境/项目隔离，如 "jellyfish/dev"
    s3_base_path: str = ""
    s3_orphan_cleanup_scope: str = ""
    # 可选：对外访问基址（CDN 或自定义域名），为空则使用 S3 自带 URL 或预签名 URL
    s3_public_base_url: str | None = None



settings = Settings()
