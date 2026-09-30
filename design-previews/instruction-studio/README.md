# Jellyfish 场次试拍交互重设计

独立设计预览，仅含虚构场次和本地交互，不连接项目接口、不调用模型、不生成视频。当前 Jellyfish 应用未替换为此设计。

## 设计决策

- 固定工作区：单元导航 → 当前内容与调整输入 → 检查结论。不在主流程打开反复切换的详情抽屉。
- 变化预览紧接输入框，保留上下文；改变要求后旧预览不能采用。
- 检查区原地表达待处理、检查中、通过；明确确认检查结论后才能演示试拍。
- 完整指令、历史、技术详情按需查看；不引入简单/高级全局开关。
- 手机端先展示检查摘要，问题按需展开；主编辑区顺序保持稳定。
- 只演示受限字段与简化文字规则，不把预览规则当 AI 行为实现；刷新重置示例。

## 参考

- Runway: https://help.runwayml.com/hc/en-us/articles/37327109429011-Creating-with-Gen-4-Video — 输入与设置靠近、会话内迭代。
- Adobe Firefly: https://helpx.adobe.com/firefly/web/firefly-video-editor/generate-videos/generate-videos-using-runway-video-models.html — 生成操作与历史分区，高级参数按需展示。

## 验证

浏览器验证 1440、1024、768、375px 无横向溢出；覆盖建议输入、预览、再次修改、采用复检、历史与明确试拍。输出在忽略的 `.sites-runtime/` 中。
