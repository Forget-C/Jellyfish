# 画布生成 A01–A32 验收证据

基线：MAIN `codex-generation-canvas`，父任务给定 `b31e0b7`。既有证据核对不根据 checkbox 推定验收完成；核对了spec原文、issues01–12 Comments、handoff/validation、下列实际results/log尾部及具名测试源码。第13票的新证据见下节；矩阵最后一列保留纵切片本身的验证边界，不声称已穷举所有故障组合。

## 第13票追加证据

环境：分支 `codex-generation-canvas-13`，基线 `b31e0b7`；独立 MySQL `jellyfish_check_gc13_01a16891`（127.0.0.1:32768）迁移至 `9b11d05c742f`。浏览器 provider、对象存储为受控替身；不访问用户数据库、不调用付费模型。日志根目录 `E/13`。所有模型通过真实 HTTP / Submitter / TaskWorker / 文件归档执行，不以未来输出构造引用。

- `journey.log`：新增 `test_generation_canvas_journey.py::test_text_then_image_then_video_uses_completed_outputs_and_preview[mysql]` **1 passed**。先完成文本→新增文本引用图片卡并保存→完成图片→新增首帧引用视频卡并保存→视频完成。每阶段回执重放不重复 Task；真实 image POST prompt 等于 preview 编译文本；真实 video POST 首帧 base64 等于刚生成的图片文件字节，preview 同样绑定该 file_id。
- `final-backend-origin.log`（显式`PYTHONPATH`；`import-origin.log`证实本worktree app与function-scope依赖）：journey、runs、selection、studio response、generation worker architecture 共 **40 passed**；复验真实 MySQL CAS、实际 HTTP commit barrier、受理/取消回执、固定依据、SSE 快照/重复/游标过期、并发与终态。2项既有 websockets 弃用警告。
- `browser-final/results.json`：新注册 `generation-canvas-acceptance` **PASS 6.2s**。真实图片 Worker / HTTP / SSE、原生 PNG 解码；1440×1000 与375×1000无页面横向溢出，媒体实际边界落在画布视口；长正文完整保留，参数 combobox 可取得键盘焦点。`media-*`、`parameters-*`、`long-text-*`截图已实际打开核查。使用本地布局缓存和0.78/0.68缩放展示一张完整卡片，媒体截图与长文截图分别观察内部滚动；不是默认自动排布所有卡的全景证明。
- `original-canvas-graph/results.json`：当前场次工作台 **PASS 25.3s**，独立真实画布入口/图交互/保存回归。`legacy-labs/results.json` **PASS 35.9s**（errors=[]、overflow=[]），项目/资产/三类实验室使用注册`legacy-labs`检查输入、历史滚动稳定、路由与原模型/资产交互；范围明确不含完整旧shell末段场次断言（当前场次已使用独立shell，旧脚本等待`.app-topbar`的默认假设过时），不将旧完整shell失败归为本次生产缺陷，也不声称全旧suite已通过。
- `typecheck.log`：`pnpm --dir front run typecheck` **PASS**；`lint.log`：275项既有、0项新增。本票未改后端应用代码，不要求为测试替身改动运行 Pylint；既有应用 Pylint 复用11/12及父最终检查。
- `parent-api-sync.md`：父已在主集成真实8000核实 selection/card_ids 并执行 `openapi:update`；normalize后零diff。本票无外部契约变化。

本轮修复：画布 tab 隐藏无关章节 CTA、流程提示与更多资产操作；项目删除响应壳测试补空画布查询替身，保留真实运行占用 guard。

## Evidence key / exact commands

证据根 `E=/private/tmp/jellyfish-generation-canvas-evidence`；表中简称均相对此根。`api/compiler/runs/images/video/dag/selection/lifecycle/parameters`指 `backend/tests/test_generation_canvas_<name>.py`（api等后缀与源码一致）。每行具名test由后述已通过整文件套件覆盖，不表示本次重新执行。

- Browser命令统一为根目录 `PLAYWRIGHT_CHANNEL=chrome node front/tests/run-browser.mjs <case> --output <directory>`（Node22 PATH；selection额外需显式隔离MySQL URL）。确切passed results.json已实读：B01=`01/browser-tyL67W` generation-canvas 6367ms；B02=`02/save-recovery-ownership` generation-canvas-save11960ms；B03=`03/final` generation-canvas-media7135ms；B04=`04/typed-graph-fresh` generation-canvas-graph13367ms；B05=`05/composer` generation-canvas-composer7480ms；B06=`06/runtime-final-owner` runtime9057ms；B07=`07/frontend/final-history` history11304ms；B08=`08/browser-visible` images7412ms；B09=`09/frontend/final-video-layout` video9778ms；B10=`10/final-combined-target` target5816ms；B11=`11/final-merged-browser` selection8566ms；B12=`12/browser-merge-final` lifecycle9166ms。上述目录均有真实run.log/backend.log或截图/数据库，results里的历史原worktree directory不是证据缺失。
- R06：`06/backend/validation.md`给完整命令：backend `.venv/bin/python -m pytest tests/test_generation_canvas_runs.py tests/test_generation_canvas_api.py tests/test_generation_canvas_compiler.py tests/test_generation_canvas_parameters.py tests/services/test_task_worker.py tests/services/test_task_service.py tests/services/test_task_queries.py tests/services/test_task_mysql.py tests/architecture -q` +显式隔离MySQL →75pass；另shared generation/contracts/submission/files/tasks/lab32pass。早期06/01部分输出仅validation/Comments报告，当前R11实日志提供更晚交叉验证。
- R07：`07/backend-validation.md`完整76-case命令及追加lost_cancel/canonical tests；B07明确3次生成无因重连增加。
- R08：`08/backend-final.txt`实读107passed1warning；完整命令 `08/handoff.md`，包括canvas api/compiler/params/runs/images/video、TaskWorker/Service/queries/MySQL/media execution/files/architecture。
- R09：`09/backend/validation.txt`实读100passed1warning；`09/backend/final-media.txt`实读27passed，命令见`09/validation.md`与issue09 Comments；SQLite+专用MySQL真实Worker，外部MockTransport/storage。
- R10：`10/final-tests.log`实读136passed2warnings；确切命令见`10/validation.md`（所有canvas套件、Task/shared contracts/generation/architecture），最终lock43pass=`10/final-lock-tests.log`，video/compiler/DAG31pass=`10/final-video-merge-tests.log`。NULL PK SAWarning在复用隔离DB有出现；不能隐去，handoff说明独立DAG7case SAWarning-as-error通过。
- R11：`11/final-tests.log`实读127passed3warnings；`11/final-merged-tests.log`23passed2warning；`11/handoff.md`列selection/DAG/runtime/API/compiler/params/images/video/真实Task/MySQL/architecture。`final-scope-tests.log`14pass见handoff。最终浏览器并发使用真实MySQL，不以SQLite并发替代。
- R12：`12/upload-retention-final.log`实读17passed2warnings，lifecycle+file response+原file service；`12/handoff.md`列其他97+1distinct验证及最初env缺失失败的纠正，不把96pass1fail直接标全绿。
- 静态：11/12 merged-lint实日志275既有/0新增；`lint/handoff.md`：typecheck/lint、save/runtime/graph/media重跑PASS（lint/runtime results实读9742ms）。Pylint各handoff10.00。13最终集成仍按实际改动跑必要检查。旧workbench periodic-save/canvas-graph证据在`02/original-*`，非当前MAIN最终全量回归。
- event stream独立：`PATH=<Node22> node --test front/tests/eventStream.test.mjs` 2pass由06 validation记录；源码断言split Unicode/CRLF/multiline在EOF前到达、generated auth、confirmed cursor、snapshot replacement。Backend精确commit次序靠R06/R11真实MySQL连接，不靠浏览器JSON最终态。

## Requirement mapping

| ID | 规格要求（原文） | 已有通过证据/对应观察 | 未覆盖或13应补/限度 |
|---|---|---|---|
| A01 | 无章节的项目创建两张画布，命名、切换、刷新后内容独立；跨项目读写受现有权限约束。 | api.test_project_canvas_can_save_empty_text_and_reopen_independently；B01 两画布/命名/切换/刷新；B02 再验证隔离。 | 跨项目 GET/DELETE=404 有确切断言；未见跨项目 PUT 或不同登录用户鉴权专场，不应将 404 等同完整权限矩阵。 |
| A02 | 同 revision 并发保存仅一份生效；同请求重放原回执，不同正文同 ID 冲突。 | api.test_mysql_real_http_connections_serialize_cas_and_identical_request_races + test_original_receipt_replays_after_new_revision_and_conflicts_do_not_overwrite；01 Comments 真实MySQL13 passed；R11 全量含该文件。 | 原票01无独立pytest log留存，仅Comments命令/结果；R11实日志复证该套件。 |
| A03 | 自动／手动保存串行；发送 A 后输入 B，A 回包不覆盖 B；丢回包、恢复、冲突和离开保护不丢输入。 | B02 + lint/save：迟到A/B串行、五秒自动保存、已提交丢回包A重开核实保留B、CAS冲突、所有权、切换前保存。front/tests/generationCanvasSave.browser.mjs:80-102 明确unknown request。 | 已覆盖 committed-but-response-lost；不推定所有浏览器崩溃/磁盘故障组合均跑过。 |
| A04 | 位置、尺寸、视角独立本地保存；运行结果和布局不推进文档修订。 | B04 布局移动/宽高/视角刷新恢复且无内容PUT；runs.test_frozen_text_stream_persists_partial_then_publishes_only_complete_result + B06 revision不变。 | 本地布局与运行结果分别验证；未见13混合媒体旅程中复验。 |
| A05 | 四类内容可读写／预览；上传失败、替换失败、删卡后迟到上传、保存失败后文件重选均符合规则。 | B03 + 12/media-upload-final；api.test_media_uploads_are_project_files_and_canvas_content_protects_them、test_each_media_content_can_replace_clear_and_save_during_upload_without_losing_file_protection。 | 实际WAV/MP4原生播放有证据；外部存储为fake，无真实云存储故障验证（规格允许）。 |
| A06 | 分组不改变输入；合法拖线保存回读，自连／环／重复边／不兼容新线准确处理。 | B04合法指针拖线/自连/重复/用途不兼容/分组操作；api.test_typed_graph_roundtrip_preserves_port_order_and_groups、test_invalid_graph_has_located_save_diagnostic。 | 环拒绝在HTTP参数化中；不能写成浏览器已逐项触发所有损坏图。 |
| A07 | 切换模型保留配置；未使用不兼容候选不阻塞，实际使用或无效参数才阻塞。 | B04切换保留；compiler.test_instruction_structure_is_located_and_used_in_capability_validation 对unused warning/used blocking；parameters两用例；api.test_model_switch_preserves_candidate_added_since_last_save。 | 编译/参数阻塞与UI模型保留分层验证，并非每个provider实际调用均覆盖。 |
| A08 | 两来源各第1项在 B 编为图片1／2；重排只改显示，同来源只一代号，不同来源同文件不合并。 | compiler.test_reorder_preserves_identity_and_same_file_is_two_inputs_with_missing_placeholder；B05 重排s10显示图片10→9→10且source不变；images.test_actual_image_subset_uses_identity_order_and_never_replaces_literal_words。 | 同输出去重及不同来源同文件实际payload见A12；来源展示不是文件身份。 |
| A09 | 空卡可连线但不可提前引用；缺失项保留占位，不能靠范围包含上游放行；补齐后原引用恢复。 | compiler.test_only_referenced_media_subset_maps_positions_and_empty_output_is_not_offered；B05空卡无候选；dag.test_missing_positions_reject_admission_and_new_missing_result_fails_only_downstream；compiler重排用例清空/恢复file。 | 缺失占位恢复为公开编译入口断言；实际模型结果缩水→补齐后浏览器原引用恢复尚未单旅程跑。 |
| A10 | @图片10不提前绑定图片1；IME、转义、同画布／跨画布／纯文本粘贴保持既定来源语义。 | B05（09/frontend/composer-regression再次PASS）；完整图片10、IME事件、结构化同画布未连线/跨画布、纯文本粘贴、转义；compiler文本转义。 | IME为harness composition事件，未人工覆盖各种OS输入法；无须将其写成真实系统输入法全覆盖。 |
| A11 | 文本按引用位置展开，不自动拼全部候选，不递归解释展开后的命令／引用。 | compiler.test_text_expands_only_at_stable_reference_and_never_recursively；video.test_expanded_source_text_never_creates_subjects_or_media_mapping；R08/R09真实模型prompt相关断言。 | 只展开实际引用，源码文本中的@/指令不再执行已测；多模态综合链由13补。 |
| A12 | 仅引用图片3时预览与真实请求均只用对应素材；重复同输出一次，不同来源同文件按两项；普通文字不被猜测替换。 | images.test_actual_image_subset_uses_identity_order_and_never_replaces_literal_words 检查POST /images/edits base64 bytes、preview==body；test_downstream_image_three_request_contains_only_the_third_model_result；B08预览第三输出本地选择不改current。 | 这是actual Worker+MockTransport真请求payload，非仅编译快照；没有真实付费provider调用。 |
| A13 | 视频四条指令按固定语法进入真实用途字段；重复首尾帧、错类型、无参数、能力不支持均定位阻止。 | video.test_video_purposes_preserve_frame_order_and_do_not_require_body_references；test_actual_worker_video_frame_fields_and_every_poll_keep_frozen_route；test_invalid_video_instructions_save_but_precheck_blocks_with_stable_target；B09。 | 四用途在适配支持范围分别验证；不应声称任一模型同时支持所有四类组合。 |
| A14 | 隐式主体、唯一命名、多组同素材、同名主体及正文保留均按确认规则编译。 | video.test_unique_named_subject_preserves_body_and_same_name_coalesces、test_implicit_and_multiple_group_material_keeps_actual_media_alias、test_actual_vidu_subject_names_and_literal_surroundings；B09三主体case。 | Vidu真实标准适配请求+MockTransport；OpenAI subject fixture已纠正，不把fabricated能力视作证据。 |
| A15 | 三类模型共用 Composer；参数在下方、能力准确，视频只生成一段且保留音轨。 | B04 共用Composer/底栏/能力；B08 图片；B09 视频单输出、native captureStream音轨1、完整下载bytes；源码rendererRegistry与现有ExperimentComposer复用。 | 三类UI分票浏览器分别PASS；13仍需同画布完整旅程；原实验室可用另列A32。 |
| A16 | 保存失败不运行旧内容；本地编辑立即废弃预检，迟到预检不恢复按钮；布局不失效；服务端拒绝过期 token。 | B06：保存失败submitCount=0，本地编辑立即清preview，迟到precheck不恢复；runs固定请求用例/receipt用例含PREVIEW_STALE；B04布局无业务PUT。 | 布局不失效为两条证据组合，未见布局变更后同token直接submit专门浏览器断言；建议13复核。 |
| A17 | 受理丢回包或重放只产生同一 run／Task；原回执不被后续修订改变；供应商不明时不盲目重发。 | B06 submissions[1]==submissions[0]、provider calls=1，刷新观察；runs.test_success_current_output_receipt_replay_and_failure_keep_prior_publication；上述success_current_output用例内FailingModel抛httpx.ReadError(acceptance unknown)，再次worker.tick后仅1次provider request。 | unknown保存和unknown运行各有独立故障注入；不要仅凭幂等代码声称unknown全链组合已跑。 |
| A18 | 受理后修改内容、模型参数及路由，真正执行仍用固定依据；相关编辑后的成果只入历史。 | runs.test_frozen_text_stream_persists_partial_then_publishes_only_complete_result + test_related_edit_keeps_completed_text_only_in_history；images.test_remote_image_submission_and_every_poll_use_frozen_route_after_edits；video.test_actual_worker_video_frame_fields_and_every_poll_keep_frozen_route；dag.test_target_reuses_valid_upstream_and_freezes_waiting_actual_request。 | 检查实际URL/auth/model/params/输入及轮询，不只是CanvasRun JSON；13跨模态本轮上游→下游固定payload仍待补。 |
| A19 | 单卡只执行自己；运行到目标复用有效上游、执行依据已变上游；未使用候选不影响流程。 | runs.test_single_card_uses_published_input_without_executing_upstream_and_rejects_stale_input 明确unused候选插入+重排后basis_current=true；dag.test_target_reuses_valid_upstream_and_freezes_waiting_actual_request；B10。 | unused候选不扩大依赖有实际执行/有效性证据，但未见所有模态候选数量变化的DAG调用计数交叉场景。 |
| A20 | 框选严格执行选中模型各一次，遗漏必要中间节点或外部输入无效时报错，不扩大范围。 | selection.test_selection_requires_omitted_middle_and_executes_every_selected_model_once、test_selection_keeps_external_stale_or_missing_inputs_blocked；B11物理框选ABC、漏B不生成，加入X/content只执行ABCX。 | 框选外部stale/missing在backend；浏览器漏中间节点且原旧B有效仍拒绝。 |
| A21 | 无重叠可并行、共同读取可并行、执行重叠拒绝；取消尚未终态不释放占用。 | selection.test_mysql_atomic_selection_conflict_shared_reads_parallel_and_cancel_hold；B11 one stream承载active选中运行+独立Y先完成；dag真实MySQL共享读取；cancel等待终态占用。 | 并发有效证据仅MySQL；早期SQLite并行失败应保留为环境不足记录，不列通过。 |
| A22 | 新成功 ResultSet 整体替换，预览不改输出；历史保留；失败／取消不清除旧输出，本轮不拿旧输出替代失败节点。 | images.test_new_complete_images_replace_whole_set_and_prior_order_remains_in_history、test_third_download_failure_retains_two_unfinished_images_and_previous_current；runs成功/失败/取消；B07/B08；dag terminal_paths无旧输出fallback。 | 完整替换、预览局部性、失败旧current分别有断言；取消媒体部分归档组合未见专场。 |
| A23 | 文本或媒体部分成果可预览／显式保存内容卡，保留未完成来源，未显式保存不供下游使用。 | runs.test_saved_unfinished_content_has_immutable_origin_and_independent_text；B07取消部分文本显式保存；B08第三下载失败2图预览/显式保存且incomplete；B09成功视频历史保存；lifecycle incomplete参数。 | 部分文本(取消)与部分图片(归档失败)有真实证据；未见部分视频或图片取消后已有归档的独立场景，不声称模态×终态笛卡尔全覆盖。 |
| A24 | 单分支失败／前置校验失败／确认流程中断不留永久 waiting；已有 Task 沿用状态；无活动工作后释放占用。 | dag.test_target_terminal_paths_end_waiting_without_old_output_fallback[param failure/node_cancel/run_cancel/interruption] 真实MySQL；test_missing_positions_reject_admission_and_new_missing_result_fails_only_downstream；runs.test_every_task_terminal_path_finishes_canvas_and_releases_scope。 | interruption测试通过真实TaskService.claim+interrupt_previous_workers确认，而非浏览器断流/杀进程；未真实杀API/Worker进程。waiting→failed/blocked/释放已有接缝证据。 |
| A25 | 取消单节点与取消整轮范围正确；未知回包不假终态，不补抓迟到成果，不新增恢复机制。 | B07丢cancel回包、刷新仍active/删除disabled、Worker真实终态后释放；runs.test_lost_cancel_response_observes_real_worker_without_reexecution；dag node/run cancel与waiting创建竞争测试。 | 真实取消范围及unknown回包已测；不保证provider立即停，未主动补抓；不将现有Task终态模拟等同全部外部供应商取消竞态。 |
| A26 | 同一画布连接承载多运行；快照切点、重复事件、过期游标、并发提交、断线重连均不丢／重放正文或重发生成。 | R06 MySQL snapshot waits committed text / distinct tasks commit order；runs.test_terminal_canonical_text_replay_converges_and_stream_observes_next_run；B07 duplicate/disconnect/expire/refresh calls精确3；B11并行同流、重连不重复正文/调用；eventStream.test.mjs 2 loopback HTTP测试。 | 实际SSE chunk/游标/事务均有证据；13需在混合媒体旅程记录exact SSE收到的事件序列/IDs与模型payload，不只UI最终态。 |
| A27 | 文本逐段到达且持久累计；刷新后接续显示；完成归档前不发布正式输出。 | runs.test_frozen_text_stream_persists_partial_then_publishes_only_complete_result；B06两次release barrier截图/文本完全视口可见、provider未结束无current、revision未变；B07刷新/终态canonical替换。 | 逐段来自真实HTTP/SSE/Worker，非一次性JSON；媒体归档前未发布由R08失败/成功测，跨模态组合待13。 |
| A28 | 下游引用阻止断线／删除；清引用后一次保存即可；活动模型／画布／项目删除须等待终态。 | api.test_reference_protects_disconnect_but_final_document_cleanup_saves_once；B05清ref+断线一次PUT；B12 source focus→清引用+删卡一次PUT；runs.test_activity_guards_allow_edits_but_reject_card_canvas_project_deletion。 | 活跃项目删除后等终态的HTTP guard有证据；浏览器项目删除完整入口未单跑。 |
| A29 | 等待下游的已知文件在受理时即被保护；删卡历史可读，删画布仅释放自己的引用，其他使用者不受影响。 | lifecycle.test_waiting_actual_image_chain_retains_uploaded_input_until_canvas_history_removed；test_deleted_cards_keep_history_and_canvas_deletion_releases_only_its_files[incomplete]；test_project_deletion_cleans_canvas_history_but_keeps_other_project_content；B12。 | 实际上传文件在waiting无Task阶段即protected；不只手工FileUsage行。删画布未知回包/retention未知回包也有B12证据。 |
| A30 | 诊断按 code／target／blocks 处理；旧快照定位不污染新编辑，不完整配置可保存，坏图不可保存。 | api真实app handler标准data封套、损坏图/重复segment；compiler stable segment targets + warning.blocks=[]；B06迟到预检丢弃/B05结构定位/B04错误后仍可保存不完整配置。 | typed定位与陈旧响应隔离分层验证；未见针对所有字段路径/所有旧diagnostic逐种编辑专场。 |
| A31 | 普通接口由 OpenAPI 生成调用；SSE 走公共流式传输；Task 写入／contracts 边界及任务中心现状保持。 | 源码useGenerationCanvasRuntime.ts导入generated Canvases，SSE导入services/eventStream.ts；R06/R11架构护栏+contracts/shared tests；B07TaskCenter删除源卡后run/node回跳；R11/12真实Uvicorn commit barrier。 | 父确认MAIN b31e0b7已核实实际:8000 selection+card_ids并成功openapi:update，normalize后diff零；证据/private/tmp/jellyfish-generation-canvas-openapi-11.json（见末尾补充）。13改外契约时再同步。Task中心通道保持属源码/回归证据，不等同全UI任务中心验收。 |
| A32 | 完成文本→图片→视频和选择执行、取消、恢复、历史保存的综合旅程；原工作台／实验室可用。 | 已有B06/07/08/09/10/11/12各纵切片；02/original-periodic-save与original-canvas-graph均PASS；R06 shared lab生成API 32pass。 | 13新组合链及浏览器证据见上节；范围选择、取消、恢复、历史显式保存复用B07/B08/B11纵切片的真实运行，不声称每种故障均在同一跨模态run中注入。 |

## 验证边界与补充说明

1. 单一组合链实际提交器/TaskWorker的文本→图片→视频，含本轮上游结果取代旧输出、unused候选不扩大依赖、真实媒体字节/用途payload与preview一致；不要只断言snapshot。
2. 统一SSE逐事件记录/精确游标及重连，unknown保存/unknown运行保留原身份、取消真终态、部分归档/历史显式保存；可复用已通过纵切片，不必穷举全部组合，但应标明未新增场景。
3. 原工作台/实验室浏览器回归、TaskCenter回跳及通道边界；父已完成当前MAIN的:8000核实与`openapi:update`；13如改契约再同步。
4. 不要把“真实流程中断”表述成浏览器断线：已有interruption是TaskService真实启动中断入口（claim+interrupt_previous_workers），未kill真实进程。部分图片归档是第三下载失败，部分文本是取消；视频partial尚无专门证据。

## 父任务后续确认（写稿后收到）

父于MAIN b31e0b7已实际curl :8000 schema核实selection+card_ids，并运行 `pnpm --dir front run openapi:update` 成功，normalize后git diff为零；证据 `/private/tmp/jellyfish-generation-canvas-openapi-11.json`。12无schema变更。故A31当前11契约主集成同步已完成；13若改对外契约父会再执行。本子任务未亲自重跑，采用父的可信执行报告。
