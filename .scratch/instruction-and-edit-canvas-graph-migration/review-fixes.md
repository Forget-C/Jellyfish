# 正式审查发现修复

审查起点 f9092e2，修复单个工作树 codex-canvas-review-fixes。原审查意见与优先级不重排。

| 原发现 | 修复 | 验证 |
| --- | --- | --- |
| Standards P2 历史 summary 移出 Tab | 恢复原生 Tab 顺序 | 三份历史的中间旧记录 Shift+Tab/Tab/Enter 打开 |
| Standards P2 无限卡／完整问题 | 有限尺寸、两行摘要、明确原记录入口及全部问题片段 Select | 长正文、40长issues、按钮几何、两个独立 clip 精确回跳、桌面/390 |
| Standards P3 新图 AntD Button | 新图动作使用 WorkbenchButton | typecheck/lint/真实操作 |
| Standards 判断建议比较重复 | 保存与素材复核共用 sceneContentKey | 原 HTTP/保存/browser，unit/typecheck |
| Spec P2 隐藏工作区自动全历史 GET | 明确阅读动作启用，移除 graph/revision 读取依赖，表单保持挂载 | 首入0 GET、明确打开才GET、refresh不重复且dirty同DOM、原cut/seam/frame全流程 |
| Spec P2 版本/list无界历史正文 | 派生依据索引+完整旧数据迁移；SQL预选最新及最近匹配记录 | 72旧记录迁移/降级、36历史无匹配和恢复、列表、复制白名单、directing全量 |

升级步骤、准确执行结果及证据ID见 acceptance.md 与共享 graph 指南。父规格及原适用性业务规则不变。
