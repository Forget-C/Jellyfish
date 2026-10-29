# 导演预设示意

`push.mp4`、`pan.mp4` 为本项目原创几何场景演示，由 `VisualPresetPicker.tsx` 的原创街道／人物 SVG 场景经 Chromium 渲染，再用 FFmpeg zoompan 滤镜制作，无外部素材、人物影像或供应商生成内容。两段均为 H.264、640×400、24 fps、3 秒、无音轨，分别演示沿视轴推进与横向移动。SVG 静态示意由 `VisualPresetPicker.tsx` 绘制。

这些文件只供预设选择器解释创作意图，不注册为项目文件或可采用输出，不代表模型执行质量。应用预设仅写入 `visualPresets.ts` 中的文字／结构化字段，不能把演示视频自动传入生成。
