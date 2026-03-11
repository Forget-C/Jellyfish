# 快速开始指南

## 项目初始化

### 1. 安装依赖

```bash
cd /Users/extreme/Projects/github.com/jellyfish
npm install
```

### 2. 启动开发服务器

```bash
npm run dev
```

浏览器将自动打开 `http://localhost:5173`

### 3. 构建生产版本

```bash
npm run build
```

构建后的文件在 `dist/` 目录

## 项目文件说明

### 核心配置文件

| 文件 | 说明 |
|------|------|
| `package.json` | 项目依赖和脚本 |
| `vite.config.ts` | Vite 构建工具配置 |
| `tsconfig.json` | TypeScript 编译配置 |
| `tailwind.config.js` | Tailwind CSS 配置 |
| `postcss.config.js` | PostCSS 配置 |
| `.eslintrc.json` | ESLint 代码检查配置 |
| `.prettierrc` | Prettier 代码格式化配置 |

### 源代码目录

```
src/
├── main.tsx          # 应用入口，挂载到 DOM
├── App.tsx           # 主应用组件，包含示例代码
├── index.css         # 全局样式（Tailwind + 自定义）
├── App.css           # App 组件特定样式
└── components/       # 可复用组件库
    ├── CustomButton.tsx    # 自定义按钮组件
    ├── CustomCard.tsx      # 自定义卡片组件
    └── index.ts           # 组件导出索引
```

## 技术栈详解

### Vite (Next Generation Frontend Tooling)

- **极速冷启动** - 基于 ES modules 的开发服务器
- **HMR 热更新** - 修改代码立即在浏览器更新，保持应用状态
- **优化的构建** - 预配置的 Rollup 构建

### React 18 + TypeScript

- **完整的类型支持** - 提升代码质量和开发体验
- **函数式组件** - 使用 Hooks 编写现代化组件
- **最佳实践** - 严格模式和 ESLint 规则

### Tailwind CSS

- **实用工具优先** - 直接在 HTML 中编写样式类
- **响应式设计** - 内置响应式断点
- **与 Ant Design 兼容** - 配置中禁用了 preflight 避免冲突

### Ant Design (antd)

- **丰富的组件** - Button, Card, Table, Form, Modal 等
- **企业级设计** - 专业的 UI 设计系统
- **国际化支持** - 多语言支持

## 常见开发任务

### 更新前端 OpenAPI 请求函数与类型

后端开发服务启动后（默认 `http://127.0.0.1:8000`），在前端目录执行：

```bash
pnpm run openapi:update
```

生成目录：

- `src/services/generated/`：生成的请求函数与类型定义
- `openapi.json`：从后端拉取的 OpenAPI 文档缓存

默认请求基础地址为同源 `/api`（见 `src/services/openapi.ts`），如需直连本地后端，可在应用启动时调用 `initOpenAPI('http://127.0.0.1:8000')`。

### 创建新组件

在 `src/components/` 目录创建新组件文件：

```tsx
// src/components/MyComponent.tsx
import { FC } from 'react'

interface Props {
  title: string
}

const MyComponent: FC<Props> = ({ title }) => {
  return <div className="p-4 rounded-lg bg-white">{title}</div>
}

export default MyComponent
```

然后在 `src/components/index.ts` 中导出：

```ts
export { default as MyComponent } from './MyComponent'
```

### 使用 Ant Design 组件

```tsx
import { Button, Card, Form, Input } from 'antd'
import { UserOutlined } from '@ant-design/icons'

function MyForm() {
  return (
    <Card title="User Info">
      <Form>
        <Form.Item label="Name">
          <Input prefix={<UserOutlined />} placeholder="Enter name" />
        </Form.Item>
        <Button type="primary">Submit</Button>
      </Form>
    </Card>
  )
}
```

### 使用 Tailwind CSS

```tsx
function MyComponent() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full">
        <h1 className="text-2xl font-bold text-gray-800 mb-4">Welcome</h1>
        <p className="text-gray-600 mb-6">This is a sample component</p>
        <button className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700">
          Click Me
        </button>
      </div>
    </div>
  )
}
```

### 环境变量

创建 `.env` 或 `.env.local` 文件：

```
VITE_API_URL=https://api.example.com
VITE_APP_NAME=MyApp
```

在代码中使用：

```tsx
const apiUrl = import.meta.env.VITE_API_URL
const appName = import.meta.env.VITE_APP_NAME
```

## 代码规范

### 运行 ESLint 检查

```bash
npm run lint
```

### 代码格式化

使用 Prettier 格式化代码（推荐使用 IDE 扩展自动格式化）：

```bash
npm install -D prettier
npx prettier --write src/
```

## 性能优化建议

1. **代码分割** - 使用动态导入分割代码
2. **懒加载组件** - React.lazy + Suspense
3. **图片优化** - 使用合适的图片格式和大小
4. **依赖优化** - 定期检查和更新依赖
5. **构建分析** - 使用 `npm install -D rollup-plugin-visualizer` 分析包大小

## 常见问题排查

### Q: 开发时样式不生效？
A: 确保在 `index.css` 中导入了 Tailwind CSS（@tailwind 指令），并在 `main.tsx` 中导入了 `index.css`。

### Q: Ant Design 和 Tailwind 样式冲突？
A: `tailwind.config.js` 中已设置 `corePlugins: { preflight: false }` 来避免冲突。

### Q: 如何调整 Ant Design 主题色？
A: 使用 Ant Design 的 ConfigProvider 或自定义 CSS 变量。

## 部署

### 构建优化的生产版本

```bash
npm run build
```

### 预览生产版本

```bash
npm run preview
```

### 部署到服务器

将 `dist/` 目录的内容部署到 Web 服务器（Nginx、Apache 等）。

## 扩展阅读

- [Vite 官方文档](https://vitejs.dev)
- [React 官方文档](https://react.dev)
- [TypeScript 官方文档](https://www.typescriptlang.org)
- [Tailwind CSS 文档](https://tailwindcss.com)
- [Ant Design 文档](https://ant.design)

---

祝你开发愉快！🚀

