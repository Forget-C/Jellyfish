# 10 画布设计卡、预设与引用编辑

Status: ready-for-agent
Blocked by: 01
Resolution: completed

## 交付目标

使用已有画布中的设计卡完成预设选择、字段编辑和引用关联；可通过固定画布直接验收。 [前端 i18n 规格](../spec.md)

## 验收条件

- [x] 在设计卡中查看预设名称、说明及设计字段，在中英文界面均能定位、预览并选择同一预设。
- [x] 编辑一个设计字段并关联已知对象，切换语言后检查自定义名称、字段内容及所选引用；包括自定义名称与内置标签恰好相同的情况。
- [x] 保存并重新打开，比较写入作品的预设参数、指令和引用标识；检查缺失引用时的提示与恢复操作。
- [x] 在浏览器中核对本模块适用的加载、空态、校验、确认、成功和错误反馈，包括图标按钮、输入框及弹窗操作的可访问名称。

## 验收记录

提交 ce891177、feee4b5a、30d3aea7。Chrome 验证中英文预设、应用后写入的中文参数、混合文字、同名用户卡、六类设计卡的候选引用和重开后的来源身份，并覆盖参考图及窄屏。

最终整轮复验中，`generation-canvas-design-editor`、`generation-canvas-design-relations`、`generation-canvas-design-references` 和 `generation-canvas-visual-presets` 通过。 [最终集成验收](12-integration-verification.md#验收记录)。
