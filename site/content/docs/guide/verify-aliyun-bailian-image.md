---
title: 线下验证阿里百炼文生图
weight: 13
description: 在接入 Studio/Celery 之前，用脚本直连 DashScope 确认 Key、模型与网络正常。
---

## 为什么先跑脚本

图片生成链路包含：前端 → API → Celery → `DashScopeImageApiAdapter`。任一环配置错误都会表现为「生成失败」。**先用脚本直连 DashScope**，可以一次性排除：

- API Key 无效或地域不一致（北京 `dashscope.aliyuncs.com` vs 国际站）
- 模型名在控制台未开通 / 无权限
- 本机网络无法访问 DashScope
- 提示词触发内容安全策略

历史上已修复的**应用层**问题包括：

- 误用 OpenAI 兼容路径 `/images/generations`（百炼需原生 `/api/v1/services/...`）
- 同步接口返回的 `content[]` 仅有 `image` 字段、无 `type`，解析器需兼容
- 长提示里「负面提示」段落应写入 `negative_prompt`，而不是全部塞进正文（否则效果差或易触发策略）

## 一次性验证步骤

在仓库 **`backend`** 目录执行：

```bash
export DASHSCOPE_API_KEY='你的 API Key'
# 可选：国际站等
# export DASHSCOPE_BASE_URL='https://dashscope.aliyuncs.com/compatible-mode/v1'
uv run python scripts/verify_dashscope_image.py
```

默认模型为 `qwen-image-2.0-pro`，可覆盖：

```bash
uv run python scripts/verify_dashscope_image.py --model qwen-image-2.0-pro
```

**成功**：终端打印 `成功:` 及一张 `https://...` 图片 URL，可在浏览器打开。  
**失败**：终端打印 `失败:` 与异常信息；请携带 `request_id`（若响应头/日志中有）到控制台查用量与审计。

## 通过后再跑全栈

1. 确认 Studio 里**图片供应商**为阿里百炼，且 `base_url` 可为兼容模式地址（适配层会规范到 DashScope 根域名）。
2. 确认**默认图片模型**与脚本里一致（或你已通过脚本验证的模型名）。
3. 重建并重启 **`backend` + `celery-worker`**（Podman / Docker 部署时图片任务在 Worker 内执行）。

## 单测（无需真实 Key）

```bash
cd backend && uv run pytest tests/core/integrations/test_dashscope_images.py -q
```
