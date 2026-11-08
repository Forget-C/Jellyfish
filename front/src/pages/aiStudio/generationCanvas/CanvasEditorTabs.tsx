import { ConfigProvider, Tabs, theme } from 'antd'
import type { TabsProps } from 'antd'

/** Shared fixed tab navigation; callers own page content and browsing state. */
export function CanvasEditorTabs({ activeKey, onChange, items }: Pick<TabsProps, 'activeKey' | 'onChange' | 'items'>) {
  const { token } = theme.useToken()
  return <ConfigProvider theme={{ components: { Tabs: {
    itemColor: token.colorTextSecondary, itemSelectedColor: token.colorText,
    itemHoverColor: token.colorText, itemActiveColor: token.colorText, inkBarColor: token.colorText,
  } } }}>
    <Tabs className="canvas-editor-tabs" activeKey={activeKey} onChange={onChange} tabBarGutter={16} items={items} />
  </ConfigProvider>
}
