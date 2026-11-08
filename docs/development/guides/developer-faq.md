# 开发与站点维护 FAQ

## 后端没启动时，前端为什么无法更新 OpenAPI？

因为 `pnpm run openapi:update` 会先请求本地后端的 `/openapi.json`。

## 开发时一定要用 Docker 吗？

不一定。前后端可以直接在宿主机启动，但仍需可用的 MySQL 和 S3 兼容存储。可以自行提供配套服务，或按[本地开发指南](local-development.md)用 Compose 管理。

## 官网为什么需要 Go？

因为 Hextra 通过 Hugo Modules 拉取，模块解析依赖 Go 工具链。

## 为什么本地 Hugo 版本也要注意？

因为 Hextra 对 Hugo 最低版本有要求。版本过低时，主题模板可能无法正常加载。工具版本及本地预览步骤见[站点维护说明](../../../site/README.md)。
