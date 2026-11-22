# 06 模型、Agent 与提示词模板管理

Status: ready-for-agent
Blocked by: 01
Resolution: completed

## 交付目标

覆盖管理区导航和模型、供应商、Agent、提示词模板的配置页面，使用户可用两种语言完成同一项配置。 [前端 i18n 规格](../spec.md)

## 验收条件

- [x] 在桌面侧栏和窄屏管理导航中，使用对应语言的可访问名称进入各配置页；核对列表、空态和加载结果。
- [x] 在模型或供应商配置中修改一个选项，在 Agent 配置中选择类型或默认项；核对译文、确认操作和保存后的稳定标识与参数。
- [x] 打开已有提示词模板，触发校验并修正，以中英文混合正文保存；重新读取后，模板正文与输入一致，校验和保存反馈跟随界面语言。
- [x] 在浏览器中核对本模块适用的加载、空态、校验、确认、成功和错误反馈，包括图标按钮、输入框及弹窗操作的可访问名称。

## 验收记录

提交 `ed38b803`、`19cb593e`。Chrome 验证桌面和窄屏导航、模型及供应商配置、Agent 默认项、模板校验与混合语言正文重读。类型检查、lint 及单元测试通过。

最终整轮复验中，`management-navigation`、`provider-management`、`model-management`、`agent-management` 和 `prompt-management` 通过。 [最终集成验收](12-integration-verification.md#验收记录)。
