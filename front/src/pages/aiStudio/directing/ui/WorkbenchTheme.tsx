import { ConfigProvider, theme } from 'antd'
import type { ReactNode } from 'react'
import './workbenchUi.css'

/** 工作台局部语义色；同源生成 AntD 配置和跨 portal 的 CSS 变量。 */
export const workbenchTokens = {
  canvas: '#0d0d0d', inset: '#141414', surface: '#1b1b1b', raised: '#242424',
  secondary: '#303030', selected: '#383838', selectedHover: '#404040', primary: '#505050', hover: '#606060',
  border: '#383838', strongBorder: '#737373', text: '#e5e5e5', muted: '#a3a3a3',
  disabled: '#737373', disabledSurface: '#171717', disabledBorder: '#2d2d2d', focus: '#69aaff',
  radius: '8px', control: '32px', prominent: '38px', icon: '16px', spacing: '8px',
} as const
const variables = Object.entries(workbenchTokens).map(([key, value]) => `--wb-${key}:${value}`).join(';')
const scopedVariables = `.canvas-workbench,.canvas-workbench-dialog,.canvas-task-center,.workbench-ui{${variables}}`

export function WorkbenchTheme({ children }: { children: ReactNode }) {
  return <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: {
    colorBgBase: workbenchTokens.canvas, colorBgLayout: workbenchTokens.inset,
    colorBgContainer: workbenchTokens.surface, colorBgElevated: workbenchTokens.raised,
    colorPrimaryBg: workbenchTokens.secondary, colorBorder: workbenchTokens.border,
    colorText: workbenchTokens.text, colorTextSecondary: workbenchTokens.muted, controlOutlineWidth: 1, borderRadius: 8,
  }, components: {
    Segmented: { itemSelectedBg: workbenchTokens.selected, itemSelectedColor: workbenchTokens.text, itemHoverBg: workbenchTokens.secondary },
    Select: { optionSelectedBg: workbenchTokens.selected },
  } }} getPopupContainer={trigger => trigger?.closest<HTMLElement>('.canvas-workbench-dialog, .canvas-workbench, .workbench-ui') || document.body}>
    <style>{scopedVariables}</style>{children}
  </ConfigProvider>
}
