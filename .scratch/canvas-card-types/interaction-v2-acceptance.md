# Q1–Q32 交互改版验收（34–42）

日期：2026-10-29。34–41 已集成；42 在独立分支完成组合修复、旧旅程迁移与验收，等待集成及最终 Standards／Spec 双轴审查。本记录不预填最终审查通过，不修改 01–33、原布局及交互验收结论。

## 验收接缝与执行边界

沿用确认的 HTTP＋真实页面：真实 React/Vite 与隔离 FastAPI，保存、输出、绑定、预检、运行和实际 Worker 请求通过公开接口核对；生成供应商与外部存储使用受控替身。浏览器验证鼠标、键盘、触摸与页面几何，不使用内部 React 状态或数据库查询作为断言接缝。单模型可有多结果，不提供多个模型的批量／全画布／运行到此处操作。

本票实际执行通过的独立浏览器用例：45（包括六个共享工作台基准），逐例见下表与 `/private/tmp/canvas42-final-case-results.json`。未受组合修复影响的当前票据验收按同产品代码复用，另列复用边界；不能将 01–33 历史通过冒充新交互已通过。

## Q1–Q32 覆盖矩阵

| 确认项 | 可见结果及证据 |
| --- | --- |
| Q1、Q4、Q8、Q23 | 单卡／单线与多选分别表达；选线退出卡片编辑，只有该线高亮；空白及 Escape 收起编辑，旧输入保留。cards、edge-management、sessions 为各票证据；本票 organization、history、runtime、journey 组合验证。复杂 Modal 遮罩关闭由 director-modal 验证。 |
| Q2、Q3 | 下方编辑展开到居中同实例 Modal；窄屏近全屏，出屏暂隐／返回恢复，明确激活才按需平移。anchored-editor 与三视口 alignment 验证，展开、关闭、自动保存保持输入。 |
| Q5、Q9 | 剪刀只检查当前线引用，有引用仅提示取消、不自动处理或跳转；目标的其他已使用输入不阻止删纯候选。edge-management、stacks 的真实 UI 与 HTTP 保护验证。 |
| Q6 | 模型加号可上传或选择尚未连线的画布来源，按兼容用途建立候选后仍需明确采用；single-submit、images 及 journey 的实际受控请求验证。 |
| Q7、Q19 | Space 平移锁定到鼠标释放；组内 Space 优先，其次 Command／Ctrl 框选，无修饰组内空白移动全组；控件输入不被捕获。cards、organization 与 stacks 覆盖。 |
| Q10、Q18、Q20、Q29 | Command／Ctrl 点选增减、普通空白框选、触摸选择多个；选区上方菜单与退出、多选直接拖成员只拖该卡。organization、filter-highlights 验证，不新增布局／下载菜单。 |
| Q11、Q12、Q13 | 堆叠三态及只读查看；内部线隐藏，外线仍属于原成员，不提供集合端点。stacks 验证真正已受理任务在查看层持续更新、触摸／Escape／空白退出仍保留堆叠。 |
| Q14、Q15、Q21 | 无嵌套或重复归属，不静默跳过部分；组内卡单独编辑／移动、空白整体移动；堆叠解除按原相对位置叠加整体位移并回多选。organization、stacks、HTTP 保护覆盖保存重开与移动。 |
| Q16、Q27 | 仅保留已有左下布局入口，组织作为整体整理并可撤销，不增加多选布局菜单；organization、stacks、tools 当前票据覆盖。 |
| Q17 | 明确诊断可直接定位字段，堆叠只定位并提示解除；director-modal、images 与 stacks 验证，不把剪刀提示变成自动跳转。 |
| Q22、Q26 | 堆叠接收端输入及删除来源导致的连带断线均受保护；外部接收端仍可管理自己的输入。stacks、61 项相关 HTTP及全画布 HTTP覆盖。 |
| Q24、Q25、Q30、Q31 | Q25 早期全画布建议被后续单模型要求取代。提交位于模型编辑区右下角，保存→预检→确认后只执行当前模型，不补跑上游。single-submit、images、video、target 的逐模型迁移与公开 HTTP拒绝非法范围覆盖。 |
| Q28、Q32 | 高亮而不隐藏普通卡、编组成员及可见线，清除保持选择与编辑；堆叠显示匹配量，查看全部成员只高亮匹配项。filter-highlights、journey、sessions 覆盖，未扩大实际输入。 |

## 组合验收中发现并修复的问题

- 跨行列选卡堆叠时，分别取最小 X／Y 会占据包围盒空角并遮住无关卡。真实拖动新增回归先红，改用封面代表成员的实际位置后绿；外部线复用同锚点，原成员坐标及解除恢复保持。红证据 `/private/tmp/canvas42-stack-origin-red`，最终 stacks 9.3s。
- 下方编辑层高于左侧添加列表，连续建卡时真实点击被挡。完整 journey 红例后调整生成画布局部层级：下方编辑 900、添加栏 950、Modal 980／遮罩 979、AntD 操作弹窗沿既有 1000；窄屏 Modal 不再被添加图标栏覆盖，最终 journey／alignment／card-list／director-modal／presets 验证。
- 本地编辑器与运行历史原共享详情未协调，history／runtime 红例出现两个可见详情。复用现有 WorkbenchDetailsProvider 的选择槽，保持单一活动详情，替换时保留业务会话；history 15.4s、runtime 11.9s 绿，六个共享工作台回归通过。共享详情本身的展示规则没有改写。
- 堆叠诊断导航新增闭包引入 lint 依赖告警，改为每次明确诊断请求使用当前布局／组织数据导航；不会因布局渲染反复居中。新增告警消除，剩余两条历史 hook 告警如实记录。

## 旧测试迁移与实际执行

没有删除旧生成业务覆盖或用 skip 掩盖已取消能力。旧 target／selection 测试改为明确单卡阶段或非法范围拒绝，保留缺失／过期阻断、上游有效结果复用、固定文件、冻结请求、历史、取消及独立单卡并发范围检查。旧导演 Enter 自动开详情改为选中→编辑按钮；屏外卡使用真实键盘入口。长表单通过展开编辑操作，不 force 点击。完整旅程仍检查描述与图片独立采用、名称映射、导演正文不跨级、对白独立采用、真实 Worker 请求、结果另存、下游固定引用和重开。

HTTP 首轮真实红例 8 failed／281 passed／28 skipped；迁移后全画布 **289 passed／28 skipped**，最终相关五模块 **24 passed／16 skipped**。证据 `/private/tmp/canvas42-http-red.log`（如目录下原命名以 helper notes 为准）、`/private/tmp/canvas42-http-green.log` 与 `/private/tmp/canvas42-http-migration-notes.md`。应用后端与 40 的已验证代码一致，复用 Pylint 10.00／10 和相关 61 passed／8 skipped。

| 真实浏览器用例 | 通过耗时 | 证据目录 |
| --- | --- | --- |
| design-scope | 15.6s | /private/tmp/canvas42-workbench/design-scope |
| generation-canvas | 7.6s | /private/tmp/canvas42-parent-generation-canvas/generation-canvas |
| generation-canvas-acceptance | 7.0s | /private/tmp/canvas42-browser-final2-acceptance/generation-canvas-acceptance |
| generation-canvas-accessible-connections | 10.9s | /private/tmp/canvas42-accessible-final/generation-canvas-accessible-connections |
| generation-canvas-alignment | 9.2s | /private/tmp/canvas42-alignment-final/generation-canvas-alignment |
| generation-canvas-alignment-baseline | 7.2s | /private/tmp/canvas42-parent-alignment-baseline/generation-canvas-alignment-baseline |
| generation-canvas-anchored-editor | 11.4s | /private/tmp/canvas42-anchored-final/generation-canvas-anchored-editor |
| generation-canvas-autosave | 18.3s | /private/tmp/canvas42-parent-autosave/generation-canvas-autosave |
| generation-canvas-card-list | 11.7s | /private/tmp/canvas42-card-list-final/generation-canvas-card-list |
| generation-canvas-chrome | 6.1s | /private/tmp/canvas42-parent-chrome/generation-canvas-chrome |
| generation-canvas-chrome-baseline | 6.9s | /private/tmp/canvas42-parent-chrome-baseline/generation-canvas-chrome-baseline |
| generation-canvas-composer | 10.5s | /private/tmp/canvas42-composer-green/generation-canvas-composer |
| generation-canvas-continuity | 14.4s | /private/tmp/canvas42-browser-final-continuity/generation-canvas-continuity |
| generation-canvas-director-modal | 17.3s | /private/tmp/canvas42-director-final/generation-canvas-director-modal |
| generation-canvas-filter-highlights | 14.6s | /private/tmp/canvas42-highlights-final/generation-canvas-filter-highlights |
| generation-canvas-filters-baseline | 6.1s | /private/tmp/canvas42-parent-filters-baseline/generation-canvas-filters-baseline |
| generation-canvas-guidance | 16.3s | /private/tmp/canvas42-browser-final-guidance/generation-canvas-guidance |
| generation-canvas-history | 15.4s | /private/tmp/canvas42-history-green/generation-canvas-history |
| generation-canvas-images | 11.6s | /private/tmp/canvas42-images-final/generation-canvas-images |
| generation-canvas-journey | 52.8s | /private/tmp/canvas42-journey-final/generation-canvas-journey |
| generation-canvas-lifecycle | 10.1s | /private/tmp/canvas42-browser-final2-lifecycle/generation-canvas-lifecycle |
| generation-canvas-mixed | 7.6s | /private/tmp/canvas42-browser-final-mixed/generation-canvas-mixed |
| generation-canvas-multi-view | 18.6s | /private/tmp/canvas42-browser-final2-multi-view/generation-canvas-multi-view |
| generation-canvas-named-references | 18.2s | /private/tmp/canvas42-browser-final3-named-references/generation-canvas-named-references |
| generation-canvas-narrative | 15.6s | /private/tmp/canvas42-browser-final-narrative/generation-canvas-narrative |
| generation-canvas-organization | 7.3s | /private/tmp/canvas42-organization-final/generation-canvas-organization |
| generation-canvas-performance | 14.1s | /private/tmp/canvas42-browser-final-performance/generation-canvas-performance |
| generation-canvas-photography | 12.1s | /private/tmp/canvas42-browser-final-photography/generation-canvas-photography |
| generation-canvas-prewire | 17.9s | /private/tmp/canvas42-parent-prewire/generation-canvas-prewire |
| generation-canvas-runtime | 11.9s | /private/tmp/canvas42-runtime-green/generation-canvas-runtime |
| generation-canvas-save | 9.1s | /private/tmp/canvas42-parent-save/generation-canvas-save |
| generation-canvas-single-submit | 10.0s | /private/tmp/canvas42-single-final/generation-canvas-single-submit |
| generation-canvas-sound | 11.6s | /private/tmp/canvas42-browser-final-sound/generation-canvas-sound |
| generation-canvas-spatial | 13.3s | /private/tmp/canvas42-browser-final-spatial/generation-canvas-spatial |
| generation-canvas-stacks | 9.3s | /private/tmp/canvas42-stack-final/generation-canvas-stacks |
| generation-canvas-target | 10.7s | /private/tmp/canvas42-browser-final-target/generation-canvas-target |
| generation-canvas-tools-baseline | 6.1s | /private/tmp/canvas42-parent-tools-baseline/generation-canvas-tools-baseline |
| generation-canvas-video | 15.2s | /private/tmp/canvas42-parent-video/generation-canvas-video |
| generation-canvas-video-bindings | 13.2s | /private/tmp/canvas42-parent-video-bindings/generation-canvas-video-bindings |
| generation-canvas-visual-presets | 11.0s | /private/tmp/canvas42-presets-final/generation-canvas-visual-presets |
| instruction-design | 18.0s | /private/tmp/canvas42-workbench/instruction-design |
| instruction-preparation | 11.6s | /private/tmp/canvas42-workbench/instruction-preparation |
| unit-design | 29.1s | /private/tmp/canvas42-workbench/unit-design |
| workbench-style | 73.3s | /private/tmp/canvas42-workbench/workbench-style |
| workbench-ui | 5.1s | /private/tmp/canvas42-workbench/workbench-ui |

当前票据同产品复用：34 cards 9.4s；35 ports 10.6s、edge-management 12.1s；36 media 9.9s；37 director-summaries 5.9s；38 graph 14.2s、tools 5.8s；41 filters 6.7s、sessions 9.2s。对应外部路径和红绿过程在各票 Comments，不重复相同代码与环境验证。这九个独立用例加本票 45 个构成本轮可核对证据；selection 的隔离 MySQL 页面不在通过数中。

## 三视口视觉核对

真实生成画布 1440×960、390×844、3830×1688；最终 alignment 9.2s 的 23 张原始截图位于 `/private/tmp/canvas42-alignment-final/generation-canvas-alignment/`。逐张原图或原图等比例联系图已实际查看，联系图 `/private/tmp/canvas42-final-visual-sheet-0.png` 至 `-2.png`，并单独检查桌面下方编辑、窄屏编辑／展开／目录、宽屏居中 Modal 及失败态。最终 journey 桌面／窄屏图位于 `/private/tmp/canvas42-journey-final/generation-canvas-journey/`，窄屏表演长字段、关系、输入及关闭入口可达，添加栏不覆盖 Modal。

顶部、面包屑、筛选、底部视图工具与小地图按工作台共同语言对照六项基准及生成基准；业务交互例外按本轮规格。桌面编辑区跟随卡片下方、可内部滚动；宽屏 Modal 使用有限屏幕尺寸居中；窄屏采用近全屏单列，未出现页面横向溢出。输出卡与导演字段使用当前能力，不复制参考图的相机品牌、下载、计费或布局下拉。动态线、连续拖动、按键释放、候选选择、采用与保存时序由真实操作断言证明，截图只证明可见状态。

## 必要检查与限制

- Node24 typecheck 通过；前端单元通过。第一次单元在默认沙箱中因本机端口监听 EPERM 失败，允许本地监听后同组通过，不记为产品失败。
- lint:check 未通过：最终仅剩 Graph 的旧 segment 定位 hook（inspectTarget.cardId／segmentId）及 useCardCandidates 的旧 entity 依赖两条告警。新增 stackFor／layout 闭包告警已消除，不改 lint 基线或通过重建基线接纳问题。
- 标准 `pnpm --dir front run openapi:update` 已由主代理在确认 8000 当前契约后执行，导出／真实 HTTP／提交 schema 一致，440 处仅尾空行生成漂移逐文件核对后恢复，证据 `/private/tmp/canvas34-42-standard-openapi-update.json`。42 未改公开 schema。
- 隔离 MySQL selection 守卫保留，未配置 `JELLYFISH_TEST_MYSQL_URL`，页面及对应竞争测试未执行；静态迁移不宣称浏览器或 MySQL通过。供应商与存储替身不证明真实生成质量。
- 42 两个辅助工作树已清理，分支及全部外部红绿证据保留。01–33、旧 layout/interactions acceptance 与实现覆盖记录字节不变；最终审查及主区集成由后续实际记录接续。
