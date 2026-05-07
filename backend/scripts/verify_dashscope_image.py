#!/usr/bin/env python3
"""线下验证阿里云百炼 DashScope 文生图（不走 Celery / DB）。

成功标准：HTTP 200 且解析出至少一张图片 URL。

用法（在 backend 目录）::

    export DASHSCOPE_API_KEY='你的API-Key'
    uv run python scripts/verify_dashscope_image.py

可选::

    export DASHSCOPE_BASE_URL='https://dashscope.aliyuncs.com'   # 默认北京
    uv run python scripts/verify_dashscope_image.py --model qwen-image-2.0-pro

若本脚本失败，请把终端完整输出（含 request_id）对照控制台用量/内容审核后再排应用层问题。
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

# 保证可导入 app（脚本在 backend/scripts/）
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

VERIFY_PROMPT = """视觉风格：现实
画面风格：真人都市

高质量电影级现实人像摄影，超详细专业演员写真：
25 岁男性，面容清俊克制，肤质细腻白皙，五官端正立体。黑色短发修剪整齐，眼神深邃锐利且带有内在的压迫感。身穿浅蓝色衬衫搭配深灰色修身西装外套，领口整洁，整体造型温和朴素，干净利落不张扬。身材修长挺拔，站姿沉稳，气质中完美融合表面的温和与隐忍的大佬气场，背景呈现现代都市办公环境，光线明亮柔和，突出人物面部细节与精神面貌。

镜头方向：正面
画面要求：
- 超高细节，8k分辨率，极致锐度与纹理
- 电影感浅景深，f/1.4大光圈，背景虚化自然明显
- 专业商业人像摄影风格 + 当代电影剧照质感
- 自然生动表情，富有故事感和角色沉浸感
- 优秀构图，经典三分法或黄金分割构图
- 完美贴合现实视觉语言与真人都市整体氛围，风格高度一致

负面提示（强烈负面）：
low quality, worst quality, blurry, deformed, bad anatomy, bad hands, missing fingers, extra limbs, poorly drawn face, bad proportions, watermark, text, logo, signature, overexposed, underexposed, plastic skin, doll, lowres, jpeg artifacts, grainycartoon, 3d render, cgi, illustration, painting, sketch, anime"""


async def _main() -> int:
    parser = argparse.ArgumentParser(description="Verify DashScope text-to-image (Aliyun Bailian)")
    parser.add_argument(
        "--model",
        default=os.environ.get("DASHSCOPE_IMAGE_MODEL", "qwen-image-2.0-pro"),
        help="DashScope 图片模型名（默认 qwen-image-2.0-pro 或环境变量 DASHSCOPE_IMAGE_MODEL）",
    )
    args = parser.parse_args()

    api_key = (os.environ.get("DASHSCOPE_API_KEY") or "").strip()
    if not api_key:
        print("错误：请设置环境变量 DASHSCOPE_API_KEY", file=sys.stderr)
        return 2

    from app.core.contracts.image_generation import ImageGenerationInput
    from app.core.contracts.provider import ProviderConfig
    from app.core.integrations.aliyun.dashscope_images import DashScopeImageApiAdapter

    base_url = (os.environ.get("DASHSCOPE_BASE_URL") or "").strip() or "https://dashscope.aliyuncs.com/compatible-mode/v1"
    cfg = ProviderConfig(provider="aliyun_bailian", api_key=api_key, base_url=base_url)
    inp = ImageGenerationInput(prompt=VERIFY_PROMPT, model=args.model, n=1, watermark=False)

    print(f"model={args.model}")
    print("说明: base_url 若含 compatible-mode，请求会规范到 DashScope 根域名再调用文生图 API")
    try:
        result = await DashScopeImageApiAdapter().generate(cfg=cfg, inp=inp, timeout_s=180.0)
    except Exception as exc:  # noqa: BLE001
        print(f"失败: {exc}", file=sys.stderr)
        return 1

    if not result.images or not result.images[0].url:
        print("失败: 无图片 URL", file=sys.stderr)
        return 1

    print("成功: 首张图 URL（可复制到浏览器验证）:")
    print(result.images[0].url)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
