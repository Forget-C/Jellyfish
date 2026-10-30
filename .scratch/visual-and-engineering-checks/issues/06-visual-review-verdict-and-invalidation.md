# 06: 提供逐区域视觉签收与失效检查

**What to build:** 评审者实际查看目标和正式原图后形成可校验的逐区域视觉结论；必须项有差异、未验证或证据变化时不能发布视觉通过，相同有效证据的复用有明确记录。

**Blocked by:** 05

**Status:** ready-for-agent

- [x] 基于05的有效基线和证据索引，记录审阅身份／时间、契约与图片身份、逐区域通过／差异／未验证、具体差异及合理差异依据；不把结构核验成功当作实际阅图。
- [x] 覆盖共同表面／标题／图标／弱状态、留白、图文比例、图片标签值与双动作、参数单位／单一素材／提交、空态、焦点与遮挡等原契约必须区域。
- [x] 必须项缺审阅、差异未解决或未验证时，签收核验不能返回视觉已通过；证据齐全但尚未阅图准确保留待审状态，普通行为检查仍保留独立结果。
- [x] 目标、实际图片或适用契约变化使原签收不再适用；不只以提交SHA判定有效性。相同图片／契约的复用注明原结果来源，不宣称重新运行或重新阅图。
- [x] 通过公开CLI与临时输入文件验证完整签收、缺项、未审阅、必须项差异、身份不匹配和更新后失效；不通过调用私有校验函数或伪造实际阅图记录证明人工审阅。
- [x] 至少完成一组来自真实页面的目标／整页／原尺寸局部检查与签收演示，实际打开原图；完整统一36组与组合状态在07复核，本票自己的签收行为和失败案例先独立验证。
- [x] 任何本票接入的汇总入口宣称视觉通过时必须核验签收；CI保留独立的视觉待审阅状态，不将其转成通过，不新增面向全部PR的人工审批平台或全自动视觉判断承诺。

**规格覆盖：** User Stories 13、14。

## 依据与边界

依据[独立规格](../spec.md)与[本轮索引](../README.md)。本轮已确认公开CLI、临时Git仓库／worktree和真实页面验收接缝；供应商与外部存储沿用受控替身，业务HTTP复用既有入口。测试观察退出码、结果、实际Git行为、真实页面及原图，不依赖私有函数或复制实现公式。

按实际改动运行必要检查，只有应用后端或公开契约变化才增加对应同步与验证。保留既有生成画布业务、旧01–60及前期环境检查完成记录；不新建平行运行器或为少量相似代码机械抽象。

## Comments

- 2026-10-30：用户确认七张纵向票据及阻塞关系，授权创建文件和更新依赖图；本轮暂不开始实现。Status仅表示分诊状态，所有验收待实际执行，不预记Completion。

- 2026-10-30：06 implementation complete, pending integration by merger. Added `front/scripts/visual-review.mjs`: current authoritative evidence is revalidated before review declaration checks; no review input produces an all-unverified template and nonzero exit. Complete explicit declarations only pass when all mandatory regions pass, with reviewer/time/source, image/capture/contract bindings and explained allowed differences. Missing, unresolved or stale records cannot approve visual status. SHA/run or descriptive manifest metadata changes require explicit same-content reuse, retaining provenance.
- Validation: public CLI evidence 35 tests passed; review 20 tests passed. TDD recorded failing preparation/acceptance/negative/manifest-metadata slices before implementation. Typecheck passed; lint baseline passed (275 existing, 0 new). No application backend/API changes, no OpenAPI/Pylint needed. No hook installation/push/old ticket edits.
- Real original inspection: six F01 1440 originals (target+actual whole page, editor, target titled card+actual card) opened independently with view_image at original detail. `/private/tmp/checks06-review/review-f01.json` and `review-f01-result.json` bind main-repo stable baseline and retained 05 original files; this reuses 05 capture rather than claiming a new page run. F01 all four applicable regions recorded; page/context is `difference` because neighboring card titles overlap near x415/y195. Other regions have concrete observations/allowed-difference bases; remaining 35 groups explicitly unverified. Overall behavior passed/evidence reviewable/visual incomplete, expected exit 1. No full visual acceptance claimed; 07 owns full matrix and combination review. See `../06-handoff.md`.
