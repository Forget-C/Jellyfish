# 项目与资产库界面一致性：实施与验收

Completion: resolved

分支：codex-project-workbench-ui-integration。审查基点：用户确认的e0d1ca8b。需求来源为同目录plan.md及本轮Q1–Q12和最终确认。实现提交9c8fd2ac；审查修正18c8484b；明确深链接返回与最终流程回归8c6802d1。

## Standards

初次发现3项：P1划分抽屉portal绕过原写入锁；P2内容宽度与移动断点重叠；P2章节划分架构说明仍指向底部保存。修正为抽屉内独立WorkspaceWriteBoundary（继承React上下文锁并接收busy/pendingSave）、编辑回调保护、统一768px断点并补767px回归、更新架构说明。只读复核后剩余0项，未报告独立代码气味。

## Spec

初次发现2项P2：资产库长名称可能裁掉进入箭头；通用项目图片卡向无导航动作的文件标题错误添加箭头。修正为资产库名称保持flex且箭头不收缩、项目箭头移入四类资源及角色的实际名称链接、文件标题移除伪指引，并增加长名称箭头几何检查。只读复核后剩余0项。8c6802d1进一步明确有效场次深链接的返回与缺失目标的章节回退，经补充只读复核未发现新问题。

## 验证

- 真实演员页面先复现普通页面包屑红测，随后通过导航、重复信息移除、单卡宽度及同资产跨项目/资产库尺寸检查。
- 工作台先复现缺少明确返回入口，再通过原有完整流程及1024px抽屉保留草稿、关闭焦点、767px编辑视图、宽屏三栏、章节返回定位。最终命令：PLAYWRIGHT_CHANNEL=chrome node front/tests/workbenchManagement.browser.mjs。证据：/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-workbench-management-BHbi2N。
- 完整划分回归通过：PLAYWRIGHT_CHANNEL=chrome node front/tests/workbenchDivision.browser.mjs，包含草稿离开保护、保存预览、历史、AI回填、原文变化核对和窄屏。旧进入场次制作与返回文案断言已按确认的箭头/章节回退流程更新。证据：/var/folders/7l/9qr93fss507b4cg9dvmf19000000gn/T/jellyfish-workbench-division-QcwH69。
- 首页/项目布局13个注册用例分批通过：主题偏好、首页活动、项目列表、概览、章节、演员、角色、三类资源、文件、设置、管理导航、实验室导航、旧实验室入口。沿用现有CLI、preflight与清单；未通过的历史断言修正后重跑受影响用例。证据目录：/private/tmp/jellyfish-ui-polish-browser、/private/tmp/jellyfish-ui-polish-remaining、/private/tmp/jellyfish-ui-polish-fixes；这些目录同时保留早期失败记录，应结合后续成功结果阅读。
- 资产库回归通过，含统一占位、长名称箭头、预览、多视角、生成、读取失败恢复、删除及主题响应式检查。没有调用真实供应商生成。
- 设置回归通过：800px上限、短风格字段同排、窄屏单列、保存锁、失败保留输入和取消恢复已保存基准。
- PLAYWRIGHT_CHANNEL=chrome pnpm --dir front run test:unit 全量通过。后续修正未改变单元用例及其被测模块，复用结果。
- 最终typecheck、build、lint:check及git diff --check通过；lint222项已知、0项新增。构建保留既有Browserslist数据过期及大包体积提示。提交标题范围检查通过。
- 一次项目列表同行几何断言失败，未改动该卡片实现；单独复查通过。没有将其改写为新预期。
- 已检查演员卡片、划分宽屏三栏及中宽抽屉截图。验证范围为真实前端与受控HTTP/隔离后端，不代表真实供应商质量、实体设备或生产部署验收。

本轮仅在当前分支提交，没有合回0718或推送远端。长期规范已同步项目内部页、管理资产库、前端布局及章节划分说明；旧功能规格保持历史身份。
