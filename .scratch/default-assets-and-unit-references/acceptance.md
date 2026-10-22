# 默认资产与单元参考解耦及卡片入口整理验收

日期：2026-10-22

全部五张实现票据已在集成分支 `codex-default-assets-and-unit-references` 完成。起点为 `0f552b38027162efb4bd05ffa9408ccbb5cc7d37`；最终运行代码修复为 `0e6b9268babe2ccd2651bd56cf76cb3e0dcb97d5`，合并提交为 `4b7fc7928fbdcf0207ea1a4e6dcef825f7ce2bad`。后续仅同步正式接口描述和本验收记录。

本地任务系统没有普通实现票据的 closed 状态，沿用既有结项约定：验收项全部勾选、Comments 记录实施及验证结果，Status 保留需求分诊语义。父规格保持原样。

## 交付与依赖

| 票据 | 独立交付 | 依赖 | 主要故事覆盖 |
| --- | --- | --- | --- |
| [01](issues/01-default-assets-and-independent-references.md) | 可选默认与实际参考解耦，候选范围、保存、AI、指令与预检一致 | 无 | 5、7 的导演边界、11–23、38–39、49–50 |
| [02](issues/02-fixed-reference-source-lifecycle.md) | 固定文件及来源快照保留，来源失效与文件失效分开，防伪继承 | 01 | 40–42、49–50 |
| [03](issues/03-identity-groups-and-existing-data-cleanup.md) | 身份主体单对象、单组、单来源，新输入拒绝及存量自动整理 | 02 | 24–31、37–38、43–50 |
| [04](issues/04-replace-identity-reference-source.md) | 明确更换来源、整组准备／应用、故障／并发保护及局部隔离 | 03 | 18、32–38、50 |
| [05](issues/05-card-actions-and-reference-entry.md) | 重复入口移除、动作横排换行、参考管理直达及可访问性 | 无 | 1–4、6–10、50 |

依赖为 01 → 02 → 03 → 04，05 独立。合并顺序为 05、01、02、03、04，随后由同一个修复代理解决两轴审查发现。50 条故事全部有对应交付。

## 最终行为

- 导演“设置默认资产”提供候选，单元“编辑参考素材”决定实际输入；候选不自动采用，单元选材不回写导演或其他单元。
- 身份用途的主体输入按人物／物件各自组成一个组，使用单一资产或一组人工素材。同组多图作为一个模型主体，其他用途和输入位置沿用既有规则。
- 更换来源先保留旧组、准备新组，明确应用时一次替换；取消、失败、迟到上传和过期基线不覆盖原内容。非目标引用的 ordinal、来源及其他字段保持。
- 正常工作台版本列表及单版本 GET 在投影前受控整理当前可编辑版本的已保存基线。原始分组先分类，多组／多来源仅留按 ordinal 排序的第一份有效参考；合规单组多图保留，空／多对象组移除，无幸存者不填图。无实际删除不写入或升 revision。
- 自动读取遇到并发修订时有界重读；普通保存及显式维护仍执行原 CAS。新提交的非法引用明确拒绝；内部快照读取、非当前场次、固定任务、Take 和已确认记录不应用自动整理。
- 来源资产改名、移除图库、取消关联或删除不改写固定输入；实际文件与权限仍须合法。准备预检核对登记、媒体及访问，执行读取字节失败时在供应商调用前阻断，不静默替换默认图。

存量处理及可选维护入口见[操作说明](../../site/content/docs/guide/agents/reference-cleanup.md)。

## 最终验证

| 检查 | 结果 | 执行与证据 |
| --- | --- | --- |
| 完整场次后端 | 553 passed、15 skipped，186.21s | 修复代理在冻结的最终代码运行 `uv run --no-sync pytest tests/directing -q`；集成后后端代码及测试与该提交无差异，明确复用；`/tmp/jellyfish-reference-review-fixes-evidence/directing-final.log` |
| 受影响 HTTP／数据库与图 | 60 passed | 含 32 个身份测试及 28 个图测试；自动列表／单版本打开、原始分组、事务回滚、CAS、真正无变化及固定历史保护 |
| 后端 Pylint | 10.00/10 | 最终后端应用代码完整检查；`/tmp/jellyfish-reference-review-fixes-evidence/pylint-final.log` |
| 默认资产真实浏览器 | 通过，30.9s | 正式 default-assets 用例，最终运行代码；`/tmp/jellyfish-reference-review-fixes-evidence/final-default-assets` |
| 来源替换真实浏览器 | 通过，82.6s | 四方向、非目标字段、上传／保存故障、迟到、并发、依据变化、能力、只读与自动列表升级；`/tmp/jellyfish-reference-review-fixes-evidence/final-visible-source` |
| 前端类型检查 | 通过 | 根代理在最终集成及生成客户端上使用 Node 24 执行 `pnpm --dir front run typecheck` |
| 前端单元／CLI | 通过，exit 0 | 根代理最终 `pnpm --dir front run test:unit`；包含真实本地端口生命周期，使用允许监听的环境 |
| 前端 lint | 291 项已知、0 项新增 | 最终 `pnpm --dir front run lint:check`；只移除 1 条已修复旧豁免，没有接纳新诊断 |
| 工作台正式组合 | 全通过 | 根代理最终 `PLAYWRIGHT_CHANNEL=chrome pnpm --dir front run test:workbench-ui`：preflight 1.6s、组件 4.0s、四画布样式 62.8s、设计范围 14.8s |
| OpenAPI／客户端 | 已同步 | 核实 8000 与当前工作区正式 app.main 完整 schema 精确一致，无 browser-test 路由，再执行标准 `pnpm --dir front run openapi:update`；只去除无关 EOF 差异 |
| 文档 | 构建与预览通过 | Hugo 158 页；真实 Chrome 读取最终整理指南 HTTP 200、正确标题及自动／维护说明；`/tmp/jellyfish-default-assets-site-preview.png` |
| 两轴审查 | 两轴各 1 项 P2 已修复，复核各 0 项 | [审查记录](review.md)，两位原审查代理分别复核 |

最终工作台组合证据已复制到 `/tmp/jellyfish-default-assets-final-workbench-4b7fc79`，原始目录为 `front/test-results/browser-0pInhW`。真实截图已查看，包括桌面与 390px、新来源准备、共享按钮与固定应用区。等待响应式布局稳定后验证几何，没有修改截图样式或 DOM 掩盖溢出。

## 证据与验证边界

- 分票早期结果分别保存在 `/tmp/jellyfish-default-assets-01-evidence`、`/tmp/jellyfish-reference-02-evidence`、`/tmp/jellyfish-reference-03-evidence`、`/tmp/jellyfish-reference-04-evidence`；05 证据目录见对应票据 Comments。最终修复与红绿日志集中在 `/tmp/jellyfish-reference-review-fixes-evidence`。
- 保留原始红灯：重复卡入口、默认来源耦合、混源和整组替换、非目标 ordinal 改变、缺少自动调用、原生按钮层级、并发 GET 冲突及无变化误升 revision。没有将早期失败日志改写为通过。
- 首次根代理单元测试受沙箱禁止监听本地端口影响而出现三项 EPERM；在允许回环监听的相同 Node 24 环境重跑通过。此项为执行环境限制，不作为产品修复。
- 15 项 skip 为既有独立集成环境用例，未计为通过；未宣称 CI、MySQL 或所有浏览器已运行。Hugo 既有主题的 Site.Data 弃用警告保留。
- 业务验证使用隔离数据库、对象存储和受控生成边界，不调用付费模型；对正常版本访问的自动整理行为已实现。未以测试请求调用真实项目的整理入口。
- 原规格 SHA-256 保持 `41fc5c0322e39fb6ef0cb7b9c798ebca8a27f77dc1e9e2c5f15d8519c3f8dff3`；五票共 64 条验收项全部完成，依赖与链接核对通过。
