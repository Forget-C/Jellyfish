---
title: "OpenAPI"
weight: 4
description: "理解前后端接口生成与同步流程。"
---

前端请求函数和类型由后端 OpenAPI 文档生成。

## 生成目录

- `front/openapi.json`
- `front/src/services/generated/`

## 更新命令

```bash
cd front
pnpm run openapi:update
```

## 生成流程

1. 先从后端拉取 `/openapi.json`
2. 写入 `front/openapi.json`
3. 再生成 `front/src/services/generated/`

## 什么时候需要更新

- 后端新增路由
- 后端修改请求或响应模型
- 前端需要消费新的接口字段


## 二进制附件

文件下载端点以 `application/octet-stream`／`format: binary` 描述字节流，generated client 返回 `Blob`。生成命令通过 `--request ./openapi/request.template` 使用受维护的 fetch transport；修改模板后运行 `pnpm --dir front run openapi:gen`，不要直接维护生成目录。

成功响应包含 `Content-Disposition: attachment` 时保留原始字节，包括文本和 JSON 附件；错误响应继续解析 JSON 并交给 `ApiError`。普通 JSON 和非附件文本接口保持原解析方式。画布单文件和 ZIP 下载均调用 generated client，预览图片地址仍使用既有文件 URL 工具。

跨源前端需要读取附件响应头，后端 CORS 显式暴露 `Content-Disposition`；`allow_headers` 只控制请求头，不能替代响应头暴露。真实画布回归同时覆盖同源代理与独立后端 origin 的下载。
