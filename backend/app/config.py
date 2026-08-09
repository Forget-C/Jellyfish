"""应用配置，从环境变量加载。"""

import json
from pathlib import Path

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

    # Database
    database_url: str = "sqlite+aiosqlite:///./jellyfish.db"

    # Redis / Celery Broker
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_db: int = 0
    redis_password: str | None = None
    celery_broker_url: str | None = None

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
    # 可选：统一前缀，方便按环境/项目隔离，如 "jellyfish/dev"
    s3_base_path: str = ""
    # 可选：对外访问基址（CDN 或自定义域名），为空则使用 S3 自带 URL 或预签名 URL
    s3_public_base_url: str | None = None

    # CAS 单镜头渲染（Step 7）。全部通过环境变量提供，仓库内不存放任何地址或凭据。
    #: 渲染使用的供应商标识：comfyui | volcengine | openai。
    cas_render_provider: str = "comfyui"
    #: ComfyUI 实例地址，例如 http://127.0.0.1:8188（无缺省值：未配置即明确失败）。
    cas_comfyui_base_url: str | None = None
    #: 工作流「输入/输出映射」JSON 的路径，见 app.core.integrations.comfyui.workflow。
    cas_comfyui_workflow_mapping: str | None = None
    #: 轮询间隔（秒）。
    cas_render_poll_interval_s: float = 3.0
    #: 单次渲染超时（秒）。视频生成通常远慢于图像，缺省给足余量。
    cas_render_timeout_s: float = 1800.0

    # 分辨率档位：预览档用于低成本试跑（如 Intel Iris Xe 等核显），
    # 成片档保持 EP001 的 1080×1920 输出规格。两者都必须是 8 的倍数。
    #: 预览档宽度。
    cas_render_preview_width: int = 432
    #: 预览档高度。432×768 = 精确 9:16（0.5625），两者都是 8 的倍数，
    #: 像素量约为成片档 1080×1920 的 16%，适合 Intel Iris Xe 等核显试跑。
    cas_render_preview_height: int = 768

    def model_post_init(self, __context: object) -> None:
        if not self.celery_broker_url or not str(self.celery_broker_url).strip():
            password_part = f":{self.redis_password}@" if self.redis_password else ""
            self.celery_broker_url = f"redis://{password_part}{self.redis_host}:{self.redis_port}/{self.redis_db}"


settings = Settings()
