FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_CACHE_DIR=/root/.cache/uv

WORKDIR /app

# System deps for common wheels / TLS
# ffmpeg/ffprobe：章节时间线导出 Worker 与 API 共用镜像时需可用的拼接探测工具
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# Install uv (Python package manager)
RUN pip install --no-cache-dir uv

# Leverage Docker layer caching
COPY backend/pyproject.toml backend/uv.lock ./
# Install only dependencies first (project sources/readme not copied yet)
RUN uv sync --frozen --no-dev --no-install-project

# App source
COPY backend/ ./

# Now install the project (and ensure entrypoints/imports work)
RUN uv sync --frozen --no-dev

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

