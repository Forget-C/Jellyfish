# Agent 检查接入与环境预检

落实本次会话复盘，复用现有工具与真实业务回归，不增加生产功能。

## 范围与成功标准

- PR 和 merge queue 运行前端 typecheck；工作台浏览器 CI 串行执行现有组件、四画布及设计完整性回归。设计完整性另有独立命令。
- 浏览器入口先验证 Node、Python 测试依赖、本机端口、媒体工具及 Chromium；后端测试提供独立预检命令并接入既有 pytest CI。失败给出明确原因，不在预检中安装依赖。
- 补齐旧／新依据回执 × 旧／新检查版本组合；以真实 HTTP 验证固定约束字段 × 显式用途 × 镜头／出现项范围，保留制作阶段与范围外单元隔离。
- 使用项目现有测试脚本和 CI 约定，更新相关操作指南；不扩充 AGENTS.md，不修改无关 Hugo 配置。

## 验证

- 前端 typecheck、工作台完整浏览器命令及设计完整性独立入口。
- 预检成功路径，以及旧 Node、缺少媒体工具、本机端口受限等可复现失败路径；以 CLI 直接运行确认。
- 受影响 HTTP 用例先检查新增组合，再运行完整后端测试；两轴审查后提交。
- GitHub runner 无法本地执行的部分明确说明，不将本地通过等同远程 CI 已通过。

## 交付与验证 · 2026-10-20

- 已接入 Frontend checks：Node 24、pnpm 固定版本、Python dev 依赖、Chromium 系统依赖与 ffmpeg；typecheck 通过后执行三组浏览器回归并上传截图。既有后端 pytest CI 先运行预检。
- 已提供 `test:preflight`、`test:design-scope`；完整工作台入口包含设计完整性回归。预检与真实后端浏览器脚本共用缓存配置，预检不安装依赖。
- 真实 HTTP 组合回归 19 项通过；最终全量后端 677 passed、19 skipped。前端 typecheck、完整三组浏览器入口与独立设计入口通过；新增 Python 预检脚本 Pylint 10.00/10。
- 预检成功路径及 Node 18、缺少 pytest、禁止本机监听、缺少 ffmpeg 的失败路径已直接验证；失败均非零退出并提供原因。两个 workflow YAML 已解析检查。
- Standards 与 Spec 两轴审查均无发现；GitHub Ubuntu runner 尚未实际执行，本地验证不等同远程 CI 已通过。
