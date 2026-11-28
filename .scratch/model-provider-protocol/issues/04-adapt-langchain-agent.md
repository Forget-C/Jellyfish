# 04: 让现有 Agent 通过 LangChain 适配器调用模型

**What to build:** 既有 Agent 通过 LangChainChatModelAdapter 取得 BaseChatModel，沿用同步、异步、流式及结构化输出工作流。

**Blocked by:** 02, 03

**Status:** ready-for-agent

- [ ] 从 Agent 入口按模型有效能力选择模型。需要工具时，跳过工具能力未知或明确不支持的型号。
- [ ] 同步和异步 Agent 均通过适配器调用公共异步协议，保留冻结的模型参数、回调和结束或错误传播。同步等待由调用侧承接。
- [ ] 用交错的流分块驱动两个并行工具调用，验证工具定义及消息正确转换、各自参数完整、工具结果按原 ID 回传，模型完成下一轮回答。
- [ ] 从结构化输出入口验证已有 schema 能取得约定结果，并验证普通消息、流式分块与 BaseChatModel 调用方兼容。
