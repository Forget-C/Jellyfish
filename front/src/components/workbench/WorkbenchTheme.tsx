import { ConfigProvider, theme } from 'antd'
import { createContext, useContext, type ReactNode } from 'react'
import { useAppStore } from '../../store/useAppStore'
import './workbenchUi.css'

/** 工作台局部语义色；同源生成 AntD 配置和跨 portal 的 CSS 变量。 */
export const workbenchTokens = {
  canvas: '#0d0d0d', inset: '#141414', surface: '#1b1b1b', raised: '#242424',
  secondary: '#303030', selected: '#383838', selectedHover: '#404040', primary: '#505050', hover: '#606060',
  primaryActive: '#383838', controlBorder: '#383838',
  border: '#383838', strongBorder: '#737373', text: '#e5e5e5', muted: '#a3a3a3',
  disabled: '#737373', disabledSurface: '#171717', disabledBorder: '#2d2d2d', focus: '#69aaff',
  radius: '8px', control: '32px', prominent: '38px', icon: '16px', spacing: '8px',
} as const
const lightTokens = {
  ...workbenchTokens,
  canvas: '#f7f8fb', inset: '#f3f6fa', surface: '#ffffff', raised: '#edf2f8',
  secondary: '#e8edf4', selected: '#e4edfb', selectedHover: '#d8e4f5', primary: '#39475a', hover: '#485b73',
  primaryActive: '#2d394a', controlBorder: '#7c8b9f',
  border: '#d5deea', strongBorder: '#7c8b9f', text: '#263244', muted: '#536174',
  disabled: '#768294', disabledSurface: '#eef1f5', disabledBorder: '#dce3ec', focus: '#245fc5',
}
const WorkbenchColorContext = createContext<{ tokens: typeof lightTokens; dark: boolean }>({ tokens: workbenchTokens, dark: true })
export const useWorkbenchColors = () => useContext(WorkbenchColorContext)

export function WorkbenchTheme({ children, adaptive = false }: { children: ReactNode; adaptive?: boolean }) {
  const preference = useAppStore(state => state.canvasAppearance)
  const appearance = useAppStore(state => state.appearance)
  const resolved = adaptive ? preference === 'follow' ? appearance : preference : 'dark'
  const dark = resolved === 'dark'
  const tokens = dark ? workbenchTokens : lightTokens
  const variables = Object.entries(tokens).map(([key, value]) => `--wb-${key}:${value}`).join(';')
  const background = resolved === 'mist' ? 'linear-gradient(125deg,#f0f5fc,#f7f8fb)' : tokens.canvas
  const lightVariables = dark ? '' : Object.entries({
    inset: tokens.inset, surface: tokens.surface, raised: tokens.raised, border: tokens.border,
    secondary: tokens.secondary, selected: tokens.selected, strongBorder: tokens.strongBorder,
    muted: tokens.muted, text: tokens.text, link: tokens.focus, filter: '#6756b5',
    error: '#b42318', errorSurface: '#fff0ee', success: '#23734d', successSurface: '#eaf6ef',
    shadow: '#243b601a', primaryText: '#ffffff',
  }).map(([key, value]) => `--wb-light-${key}:${value}`).join(';')
  const scopedVariables = `.canvas-workbench,.canvas-workbench-dialog,.canvas-task-center,.workbench-ui{${variables};${lightVariables};--wb-background-image:${resolved === 'mist' ? background : 'none'};--wb-background:${background};--wb-scheme:${dark ? 'dark' : 'light'};color-scheme:${dark ? 'dark' : 'light'}}`
  return <WorkbenchColorContext.Provider value={{ tokens, dark }}><ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm, token: {
    colorBgBase: tokens.canvas, colorBgLayout: tokens.inset,
    colorBgContainer: tokens.surface, colorBgElevated: tokens.raised,
    colorPrimaryBg: tokens.secondary, colorBorder: tokens.controlBorder,
    colorText: tokens.text, colorTextSecondary: tokens.muted, controlOutlineWidth: 1, borderRadius: 8,
  }, components: {
    Button: { colorPrimary: tokens.primary, colorPrimaryHover: tokens.hover, colorPrimaryActive: tokens.primaryActive },
    Segmented: { itemSelectedBg: tokens.selected, itemSelectedColor: tokens.text, itemHoverBg: tokens.secondary },
    Select: { optionSelectedBg: tokens.selected },
  } }} getPopupContainer={trigger => trigger?.closest<HTMLElement>('.canvas-workbench-dialog, .canvas-workbench, .workbench-ui') || document.body}>
    <style>{scopedVariables}</style>{children}
  </ConfigProvider></WorkbenchColorContext.Provider>
}
