# 贡献指南

通过 [Issue](https://github.com/Forget-C/Jellyfish/issues) 反馈问题或提出建议，通过 Pull Request 改进代码或文档。

## 开发前

1. 阅读[项目结构](../architecture/project-structure.md)及[本地开发](local-development.md)。
2. 按改动范围查阅[开发规范](../standards/development.md)和[审查来源索引](../standards/review-sources.md)，沿用现有职责分层与命名。
3. 只同步本次受影响的文档。面向用户的说明在官网维护，技术规则和实现资料归入对应开发文档。

## 提交前

- 按改动范围检查前后端启动、受影响流程和必要测试；验证要求见[开发规范](../standards/development.md#标准完成状态)。
- 对外接口变化时按[接口同步规范](../standards/development.md#接口与文档同步)更新生成客户端。
- 站点内容变化后使用[站点预览说明](../../../site/README.md)验证页面和引用。
- 按[提交规范](../standards/commit-convention.md)撰写标题。
