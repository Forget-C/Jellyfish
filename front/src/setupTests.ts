import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// antd 组件依赖 matchMedia，jsdom 未实现。
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
}

// jsdom 未实现带伪元素参数的 getComputedStyle，会抛
// "Not implemented: window.getComputedStyle(elt, pseudoElt)"。
// 两处受影响：
// 1. antd 的 rc-table 在挂载时测量滚动条宽度 → 大量噪声堆栈；
// 2. Testing Library 计算可访问名称（getByRole 的 name 选项）时会读取伪元素生成内容，
//    失败后名称算不出来，导致按名称查询 button 找不到元素。
// 这里丢弃伪元素参数并回退到元素自身样式：jsdom 本就不支持伪元素样式，
// 该退化不会掩盖任何真实的产品缺陷。
const originalGetComputedStyle = window.getComputedStyle.bind(window)
window.getComputedStyle = ((element: Element, pseudoElement?: string | null) =>
  pseudoElement
    ? originalGetComputedStyle(element)
    : originalGetComputedStyle(element)) as typeof window.getComputedStyle

// jsdom 不实现 URL.createObjectURL（字幕下载会用到）。
if (!URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:mock'
  URL.revokeObjectURL = () => undefined
}
