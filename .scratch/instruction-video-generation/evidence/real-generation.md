# 四种模式真实生成验收

供应商：Vidu；模型：`viduq3-turbo`；AI 起草与六岗审稿：`deepseek-v4.1-flash`。每种模式固定 5 秒、16:9。

所有模式均经过真实 AI 起草、明确应用、真实六岗审稿及明确确认，再提交视频；未放宽任何门槛。实际输出下载保存，通过 ffprobe 探测和 FFmpeg 完整解码；候选可查且时间线初始为空，再明确采用 0–1000ms 区间并保存。

| 模式 | 视频任务 | Take | 时长 | 结果 |
| --- | --- | --- | --- | --- |
| 纯提示词 | `44e3507dab3f4254a7b3d32850e190bc` | `132dc2b6c1ed416b969d38c041c660f2` | 5.042s | 已保存、可解码、明确采用 |
| 提示词＋首帧 | `07e3dc8191c94cb2980e83e780fabc2c` | `be23628002624accbcc132e0efe5f51f` | 5.042s | 已保存、可解码、明确采用 |
| 提示词＋首尾帧 | `e04504f343c04846b9f04a31fc810cf0` | `7241d33a7f6b401ba4ea7d759b0ea798` | 5.042s | 已保存、可解码、明确采用 |
| 提示词＋主体组两图 | `11c2b561de9242c7ab28ece056d442e7` | `d169c69c772947e79e0c7f89553b95de` | 5.042s | 已保存、可解码、明确采用 |

首帧／首尾帧输入采用两个位置不同的 640×360 红方块 PNG；主体模式使用同组两张图。图片 SHA-256、固定指令、角色／分组及参数见本地 JSON。

失败与恢复：首帧、主体模式的前两轮 AI 审稿出现返回清单身份不一致（ValueError），未提交该轮视频。后续新审稿任务通过原校验并明确确认后，才提交视频；主体最终轮在一次失败后重试成功。

可播放文件及完整脱敏记录保存在主工作区 `front/test-results/instruction-video-real/`：`text.mp4`、`first.mp4`、`first-last.mp4`、`subject.mp4`、`results.json`。该目录由测试规则忽略，未包含数据库或模型凭据。

首尾帧视频另外提取首个与末尾可解码画面进行目视核对：红方块分别位于输入的左侧与右侧位置，预览保存在 `first-last-preview.png`、`first-last-end.png`。

本次验证使用隔离 SQLite 与独立对象存储前缀，未修改业务项目数据库。该记录验证生成与采用基础链路，不替代人工判断动作覆盖或接缝合格。

本地视频：[纯提示词](/Users/extreme/Projects/github.com/jellyfish/front/test-results/instruction-video-real/text.mp4)、[首帧](/Users/extreme/Projects/github.com/jellyfish/front/test-results/instruction-video-real/first.mp4)、[首尾帧](/Users/extreme/Projects/github.com/jellyfish/front/test-results/instruction-video-real/first-last.mp4)、[主体组](/Users/extreme/Projects/github.com/jellyfish/front/test-results/instruction-video-real/subject.mp4)。
