"""应用配置，从环境变量加载。"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # App
    app_name: str = "Jellyfish API"
    debug: bool = False

    # API
    api_v1_prefix: str = "/api/v1"

    # Database
    database_url: str = "sqlite+aiosqlite:///./jellyfish.db"

    # CORS：本地开发默认允许 Vite 常用端口
    cors_origins: list[str] = [
        "http://localhost:7788",
        "http://127.0.0.1:7788",
        "http://localhost:7788",
        "http://127.0.0.1:7788",
    ]

    # LLM（影视技能抽取用，可选）
    # 当设置 LLM_PROVIDER 时，自动选择对应供应商配置；
    # 未设置时根据已配置的 API Key 自动检测（优先 OPENAI，其次 MINIMAX）。
    llm_provider: str | None = None

    openai_api_key: str | None = None
    openai_base_url: str | None = None
    openai_model: str = "gpt-4o-mini"

    # MiniMax（OpenAI 兼容 API，可替代 OpenAI 用于影视技能抽取）
    minimax_api_key: str | None = None
    minimax_base_url: str = "https://api.minimax.io/v1"
    minimax_model: str = "MiniMax-M2.5"

    # 图片生成（技能生成类：演员/角色/道具/场景/服装/镜头帧图片）
    image_api_provider: str | None = None
    image_api_key: str | None = None
    image_api_base_url: str | None = None

    # 视频生成（/film/generated_video 等）
    video_api_provider: str | None = None
    video_api_key: str | None = None
    video_api_base_url: str | None = None

    # S3 / 对象存储（用于素材文件）
    s3_endpoint_url: str | None = None
    s3_region_name: str | None = None
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None
    s3_bucket_name: str | None = None
    # 可选：统一前缀，方便按环境/项目隔离，如 "jellyfish/dev"
    s3_base_path: str = ""
    # 可选：对外访问基址（CDN 或自定义域名），为空则使用 S3 自带 URL 或预签名 URL
    s3_public_base_url: str | None = None


settings = Settings()
