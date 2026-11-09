---
title: "安装说明"
weight: 1
description: "准备 Jellyfish 的部署环境并获取项目。"
---

通过 Docker Compose 安装 Jellyfish。准备 Git、Docker 和 Compose，确认本机有足够空间保存数据库和生成的媒体文件。

```bash
git clone https://github.com/Forget-C/Jellyfish.git
cd Jellyfish
```

在仓库根目录按 [Docker 部署](../docker/)复制配置并启动。部署包含应用、数据库和对象存储。首次启动需要拉取或构建镜像并初始化数据库。

如果你准备修改代码或进行前后端联调，使用[开发快速开始](../local-dev/)。
