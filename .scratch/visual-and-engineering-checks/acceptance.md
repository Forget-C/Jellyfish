# 本轮组合验收：07

2026-10-30。执行来源 `1c7769b9654bcab48c8cf9bbdf1427cd39c80e33`，Node v24.22.1／Chrome156.0.8078.48／darwin arm64。最终组合旅程 **behavior passed**，证据 **reviewable**；实际原图审阅声明经06公开CLI核验为 **visual passed**。这是本文明确列出的三视口／状态与受控供应商、存储范围内结论，不代表远程CI、真实模型艺术质量或其他设备通过。最终 merger 的双轴审查另行进行。

## 可复查产物与命令

稳定证据目录：`/private/tmp/checks07-four-card-final-acceptance/generation-canvas-four-card-acceptance`（下文 `$E`）。目标统一使用主仓库 `/Users/extreme/Projects/github.com/jellyfish/front/tests/visual-baselines/c-794ee4a0-v1/manifest.json`（下文 `$M`），其目标PNG及contract绝对路径不依赖将清理的实施worktree。证据目录不在worktree内，保留清理后可复查。

- [原运行器结果](/private/tmp/checks07-four-card-final-acceptance/results.json)：preflight passed；完整case passed，220.6s。
- [完整配对索引](/private/tmp/checks07-four-card-final-acceptance/generation-canvas-four-card-acceptance/visual-index.md)、[matrix](/private/tmp/checks07-four-card-final-acceptance/generation-canvas-four-card-acceptance/matrix.json)、[run](/private/tmp/checks07-four-card-final-acceptance/generation-canvas-four-card-acceptance/visual-run.json)、[实际状态](/private/tmp/checks07-four-card-final-acceptance/generation-canvas-four-card-acceptance/visual-states.json)、[日志](/private/tmp/checks07-four-card-final-acceptance/generation-canvas-four-card-acceptance/run.log)。run记录真实来源提交；采集时唯一未提交项是本轮新增handoff文档，没有未提交应用或测试修改。
- [逐区域审阅声明](/private/tmp/checks07-four-card-final-acceptance/generation-canvas-four-card-acceptance/review.json)：36组、192个适用区域，逐项observation与允许差异依据，绑定每组原图与capture哈希。[核验结果](/private/tmp/checks07-four-card-final-acceptance/generation-canvas-four-card-acceptance/review-result.json)：exit0，passed／reviewable／passed。
- [初始无签收结果](/private/tmp/checks07-four-card-final-acceptance/generation-canvas-four-card-acceptance/review-prepared.json)：exit1，passed／reviewable／not-reviewed。证据齐全不推导视觉通过。
- [来源／参数实际滚动证据](/private/tmp/checks07-four-card-final-acceptance/generation-canvas-four-card-acceptance/explicit-scroll-evidence.json)与同目录四张 `*-scrolled-*-editor.png` 为额外公开操作补图，不覆盖F10初始原图。review额外列出补图哈希，CLI的强制图像绑定仍为36组原图。

```bash
export PATH=/Users/extreme/.nvm/versions/node/v24.22.1/bin:$PATH
M=/Users/extreme/Projects/github.com/jellyfish/front/tests/visual-baselines/c-794ee4a0-v1/manifest.json
E=/private/tmp/checks07-four-card-final-acceptance/generation-canvas-four-card-acceptance
C60_PROTOTYPE_MANIFEST="$M" PLAYWRIGHT_CHANNEL=chrome \
pnpm --dir front run test:browser generation-canvas-four-card-acceptance \
  --output /private/tmp/checks07-four-card-final-acceptance
PLAYWRIGHT_CHANNEL=chrome node front/scripts/visual-evidence.mjs \
  --manifest "$M" --matrix "$E/matrix.json" --run "$E/visual-run.json" \
  --output "$E/ci-visual-result-local.json"
PLAYWRIGHT_CHANNEL=chrome node front/scripts/visual-review.mjs \
  --manifest "$M" --matrix "$E/matrix.json" --run "$E/visual-run.json" \
  --review "$E/review.json" --output "$E/review-result.json"
```

在独立工作树运行，使用已有依赖／虚拟环境链接；未安装主仓库依赖或hook。后续文档提交／合并不冒称重新采集，明确复用上述来源、fixture内容与原图身份。

## 实际阅图范围

本轮实际调用 `view_image`、original detail并以original输出：目标36张编辑区与36张wholepage，1440／3830的全部16张默认／空态cardWithTitle及8张展开card body。展开外部标题对照同类默认title，未用暗遮罩下的目标卡面证明标题。390原型无卡面是contract已记录限制；仍实际查看36张正式含标题卡面。

最终固定来源目录的全部36张actual editor、36张actual page、36张actual card均重新打开查看，共108张，另打开四张滚动补图；不是把中间失败运行的阅图当作最终运行。每个适用page/context、card/title、editor/body、editor/actions、model inputs／parameters和empty-state的具体判断在review.json内。文字经脚本序列化为JSON，判断来自实际阅图及明确规格，没有脚本图像打分或从CLI成功自动填pass。

| 组 | 状态 | 1440×960 | 390×844 | 3830×1688 |
| --- | --- | --- | --- | --- |
| F01 文本 | 默认 | 4区域通过 | 4区域通过 | 4区域通过 |
| F02 文本 | 展开 | 4区域通过 | 4区域通过 | 4区域通过 |
| F03 文本 | 空态 | 5区域通过 | 5区域通过 | 5区域通过 |
| F04 图片 | 默认 | 4区域通过 | 4区域通过 | 4区域通过 |
| F05 图片 | 展开 | 4区域通过 | 4区域通过 | 4区域通过 |
| F06 图片 | 空态 | 5区域通过 | 5区域通过 | 5区域通过 |
| F07 文本模型 | 默认 | 6区域通过 | 6区域通过 | 6区域通过 |
| F08 文本模型 | 展开 | 6区域通过 | 6区域通过 | 6区域通过 |
| F09 文本模型 | 空态 | 7区域通过 | 7区域通过 | 7区域通过 |
| F10 图片模型 | 默认 | 6区域通过，见滚动限定 | 6区域通过，见滚动限定 | 6区域通过，见滚动限定 |
| F11 图片模型 | 展开 | 6区域通过 | 6区域通过，见参数限定 | 6区域通过 |
| F12 图片模型 | 空态 | 7区域通过 | 7区域通过，见参数限定 | 7区域通过 |

## 具体允许差异与范围

- 共享helper修复后，邻卡标题在不同横坐标分布，36张wholepage未再出现06发现的x415／y195多标题堆叠。真实项目工具、十二卡、连线与示意原型的位置不同；目标密度、暗色圆角、图标＋外部标题、弱状态、正文和固定动作按原图核对。
- 基础文本是实际37字／0字；文本模型显示实际正式文本摘要与已采用1，替代原型generic ready图标；结构化@文本1保留。样本名为占位，不要求硬编码原型名称。文本展开增加真实长文阅读空间，维持同一会话。基础图片展开自然高，未回退到760px无意义图片空白。
- 图片为本轮原创受控几何图320×180、街角参考-替换／项目文件，左浅块和右深矩形在编辑区完整contain；图像模型为受控红色240×120正式输出、3结果、1:1／standard／3张。具体文件、模型与输出身份绑定在每组capture；原型照片、16:9／2K仅占位。卡面可cover，未用替身图案宣称真实艺术质量。
- 390基础图片信息和值、两个动作竖排；模型空依据正常短句，未照抄原型竖排缺陷。正式默认／展开近全屏374×828，保留头部控制和底部动作，没有原型切换条；背景工具暂停。桌面显式展开模型为已有阅读模式，默认仍700×240紧凑，不恢复候选表。
- **F10三视口初始第二条“查看来源”在素材区域下缘被裁**，桌面正式240高与原型310高不同；没有隐瞒或用补图替换初始图。原始spec C紧凑素材栏及已有内容状态明确允许条目多时内部滚动，要求不隐藏取消、不挤走参数／关闭／提交。三视口真实wheel后最后“查看来源”与取消中心命中；1440／3830为scrollTop46、client151／total197，390为33、client144／total177。取消初始可见，补图中两来源完整，底部提交固定，故按这条文字规格允许，未为通过改产品布局。
- **390 F10／F11／F12初始3张在参数区右侧溢出**。spec C明确单行参数不足宽时只在参数区域横向滚动。F10真实wheel＋原生Tab到数量，补图显示3张、中心命中true（left81、client240／total321），关闭／提交固定；原生Shift+Tab返回完整模型选择控件通过。同一组件／相同配置下据此判断F11／F12参数可达，未冒称分别执行过补充Tab，不要求首帧同时显示全部参数。

没有遗留未解释的视觉difference或unverified区域。本结论仅覆盖这些已查看原图、指定状态和公开交互；未扩展为产品其他界面或设备的完整视觉批准。

## 拒绝与失效负例

均用同一06公开CLI及本轮真实capture，退出1：

| 输入 | 结果 | 可复查文件 |
| --- | --- | --- |
| 不传review | not-reviewed；行为passed、证据reviewable仍保留 | `$E/review-prepared.json` |
| 修改签收中的actual editor哈希 | invalid，image/capture identity mismatch | `$E/review-invalid-image-result.json` |
| 删除一项必审region | invalid，review regions missing/duplicated | `$E/review-invalid-region-result.json` |
| 仅保留副本中F01actual editor换成同尺寸F03真实PNG，沿用旧review | evidence failed，capture file/content identity mismatch，不能沿用旧签收 | `/private/tmp/checks07-invalid-current-image/review-result-mutated.json` |

原始最终证据未被负例修改。完整命令／工程结果与中间失败详见[07 handoff](07-handoff.md)，包括61 CLI、14临时Git、unit、lint275／0、typecheck、common-shell48.3s。CI配置／登记／严格传播及旧80文件哈希再次检查通过：`/private/tmp/checks07-config-and-preservation.log`；没有把本地配置检查冒称远程CI执行。

主代理另实际补看最终F10桌面scrolled-source与390scrolled-parameters两张原图，确认第二来源查看入口、3张及固定提交可见；未声称主代理复看全部108张。

## 最终审查修复的独立复核

最终Spec审查发现的默认浏览器P2已在独立分支修复：未设置channel沿用Playwright Chromium，显式Chrome保留。公开CLI新增默认runtime回归取得真实RED→GREEN；Chrome完整CLI62项及默认Chromium evidence／review56项通过，typecheck通过。修复后原签收机械复核仍为passed／reviewable／passed（36组），没有重新采集或声称重新阅图。精确命令、日志、临时安装范围与验证局限见[review-fix](review-fix.md)；原执行来源及上述人工阅图结论保持原身份。

## 集成复核与清理

最终代码头 `5ecfdf63`，比较基线 `cbf82d42`。Standards硬规则及判断性smell均0项；Spec原1项P2修复后未解决0项。独立报告保留在 `/private/tmp/checks-final-review/standards.md`、`/private/tmp/checks-final-review/spec.md`；审查者未冒称独立重跑全部检查或全量阅图。

主代理在最终集成代码上使用临时缓存的默认Chromium再次调用公开review CLI，36组返回 `behavior=passed / evidence=reviewable / visual=passed`，结果 `/private/tmp/checks-final-review/root-chromium-signoff-recheck.json`。仅重读现有原图、契约与签收，不重采或重新阅图，运行来源仍为 `1c7769b9`。

本轮8个干净、已提交的实现worktree已移除，分支和外部证据保留。票01原忽略证据另保存在 `/private/tmp/checks01-accepted/`；用户原型worktree及4197服务未动。清理后核对旧80份记录哈希完全一致；后端editable导入仍指向主工作区 `backend/app/__init__.py`。未推送、未安装实际开发仓库hook，远程CI未执行。
