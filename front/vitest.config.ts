import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// 独立于 vite.config.ts：保持生产构建配置不受测试配置影响。
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
