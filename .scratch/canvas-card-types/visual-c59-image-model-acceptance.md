# 59 图片模型 C 参数与预览验收

2026-10-30。59在58共用模型布局上完成图片专属对齐；产品提交 `7940e2cf`，已同步集成分支 `942c6220`，同步提交 `a5dc0c55`。本记录仅说明59，不把01–54旧结论或本票结果替代60四类组合验收。

## 实际执行

- 已确认接缝：真实页面＋公开HTTP；真实数据库、保存、预检、TaskWorker、输出发布和文件接口，只有供应商HTTP与外部存储使用受控替身。运行态用供应商transport的受控响应延迟产生，没有伪造runtime或直接写入结果。
- 红测先复现数量输入仅显示`3`，修复后继续复现卡面结果计数独立占行；最终角落使用固定的上一张／当前位置／下一张和完整图入口，不因结果数量增加而横向铺满卡片。
- Node24统一入口：`pnpm --dir front run test:browser generation-canvas-image-model-focus --output /private/tmp/c59-merged-verified`，preflight0.9s、用例21.1s通过；Chrome，隔离4459／8459。结果与日志见[结果](/private/tmp/c59-merged-verified/results.json)，[F矩阵](/private/tmp/c59-merged-verified/generation-canvas-image-model-focus/manifest.json)。
- 原有`generation-canvas-images`13.9s通过，覆盖历史／多图／未完成副本和独立采用，证据[结果](/private/tmp/c59-existing-images/results.json)。原默认媒体预览分支保留，图片卡新增局部模式；没有改视频／音频的原生播放。
- 主版本Node24 typecheck、diff检查和测试fixture语法检查通过；62份01–54／旧验收文件SHA256不变。未改应用后端、公开契约、OpenAPI或generated client，不机械执行客户端再生或应用Pylint；Python变更仅为既有浏览器供应商替身的可控延迟。

## F10–F12三视口图片

目标来自[保留C原型矩阵](../../front/tests/visual-baselines/c-794ee4a0-v1/manifest.json)及[原型局限](../../front/tests/visual-baselines/c-794ee4a0-v1/observations.md)，包括1440×960、390×844、3830×1688。正式文件目录为 `/private/tmp/c59-merged-verified/generation-canvas-image-model-focus`，每组前缀含类型、视口、状态，`-page`是整页、`-editor`是原尺寸编辑区，桌面另有`-card`。移动原型不展示卡面，不将缺目标视为正式卡面免验；最终统一四类移动卡面与工具栏组合由60收口。

| 状态 | 正式前缀（三种宽度分别1440、390、3830） | 逐区域结论 |
| --- | --- | --- |
| F10 默认 | `F10-image-model-{width}-default` | 共同C表面、外框、圆角、图标／名称／同行状态、轻量头、无贯穿分割线、左右依据／创作描述、全宽单行底栏通过。真实文本／图片各自采用，实际素材数2；模型／画幅／分辨率短值和`3 张`、单一素材及右端圆提交可达。卡面图片填满185px主体、角落切换／计数及完整图入口、卡底真实状态通过。 |
| F11 展开 | `F11-image-model-{width}-expanded` | 相同依据、正文及输出保持，展开头和内容层级一致。桌面扩宽而非另一套表单，移动沿共同近全屏布局；正文和依据各自滚动，底栏与提交可达。展开遮罩覆盖背后卡面是模态阅读上下文，卡面视觉以F10同一输出原图判断。 |
| F12 空态 | `F12-image-model-{width}-empty` | 空依据可读、正文标签和placeholder保留，素材数0，提交禁用及说明可见；无输出卡面居中图片图标和“尚未生成”，没有额外操作说明段落。此状态有已选合法模型但无输入／输出，不拿未选模型诊断替代。 |

实际查看三视口9组原尺寸编辑图、两个桌面视口6张卡图及运行、失败、失效、只读、长名／多来源／长正文和窄屏参数整页图；未声称仅靠CSS、缩小联系图或截图数量即可证明视觉。移动展开截图等可见尺寸稳定后使用page clip；图片文件为374×828，不以过渡帧作为原尺寸证据。

合理差异逐项保留：正式名称沿既有“图片模型卡”和来源类型回退名称，不复制原型“画面生成／林夏”等样例；真实模型为`image-model`，实际值`1:1`／`standard`／`3 张`，不硬编码原型16:9／2K／1张。图片为真实上传320×180受控图及Worker产出的240×120三色PNG，不宣称艺术质量等同参考照片。13px正文与真实名称可能换行，约300px编辑高度与原型约309px属内容／控件密度适配，未增加常驻区域或扩大表单。缩略图cover只改变预览，完整图Modal等比例阅读且不改输出文件。

## 真实行为与附加状态

- 上传真实文件为基础图片，初始仅连线时HTTP确认采用数0，页面分别采用文本、图片后确认采用数2；采用入口复用58，未复制绑定逻辑。
- 当前单模型预检、确认后由Worker发布3项正式结果；角落两次“下一张”显示第三项，运行接口完整有序输出集合不变。打开完整图并关闭，画布修订不变，不触发生成。
- `image-model-running.png`用真实外部响应延迟观察运行，预检弹窗已退出；`image-model-failed-retained.png`等待页面失败状态稳定，原正式三图仍保留。后续键盘修改创作描述，HTTP实际正文更新、卡底“依据已变”可见，见`image-model-stale.png`。
- 长模型名通过正常模型更新HTTP设置；长正文独立滚动、两来源不丢失，图片数量在页面从3编辑为2，HTTP确认真实值2。窄屏聚焦数量使参数区域局部滚动，素材和提交仍固定可达，见`image-model-long-name-text-and-sources.png`、`image-model-mobile-parameters.png`。
- 保存重开保留配置和正文；第二标签真实只读，正文不可写、提交禁用，见`image-model-readonly.png`。单独清空模型选择后，未取得图片适配器能力时不伪造画幅／分辨率／数量控件，保留原配置与诊断，见`image-model-unselected-parameters.png`。

## 边界

四类工具栏边缘组合、完整36组统一图片矩阵和B摄影／编组等回归由60最终执行，不用59单票替代。既有lint两条hooks依赖告警及受控供应商／存储不证明真实供应商质量的限制保持；01–54和旧验收未修改，未推送或创建PR。
