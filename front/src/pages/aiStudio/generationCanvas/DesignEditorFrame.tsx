import { canvasEditorFocusTargets } from './CanvasCardEditor'
import { createContext, useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ConfigProvider, Dropdown, Switch, Tabs, Tooltip } from 'antd'
import { MoreOutlined } from '@ant-design/icons'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'

export const DesignEditorActive = createContext(true)
export const DesignMetadataVisible = createContext(false)

/** 设计与参考分区保持挂载；浏览不改变采用关系或字段保存方式。 */
export function DesignEditorFrame({ children, references, onDuplicate, disabled, editorOpen = true }: { children: ReactNode; references: ReactNode; onDuplicate?: () => void; disabled?: boolean; editorOpen?: boolean }) {
  const [tab, setTab] = useState('design')
  const [menuOpen, setMenuVisible] = useState(false)
  const [metadataVisible, setMetadataVisible] = useState(false)
  const frame = useRef<HTMLDivElement>(null)
  const triggerHost = useRef<HTMLSpanElement>(null)
  const menuId = useId()
  const setMenuOpen = useCallback((open: boolean) => {
    // 退场动画中的菜单立即停止接收焦点，防止内部延迟导航夺回焦点。
    const menu = document.getElementById(menuId)
    if (menu) menu.inert = !open
    setMenuVisible(open)
  }, [menuId])
  useEffect(() => { if (!editorOpen) { setMenuOpen(false); setMetadataVisible(false) } }, [editorOpen, setMenuOpen])
  useEffect(() => {
    if (!menuOpen) return
    // 自己管理可取消的入场焦点，避免菜单已关闭后组件库延迟聚焦。
    let focusFrame = 0
    const focusMenu = () => {
      const menu = document.getElementById(menuId)
      const target = menu?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') || menu
      target?.focus({ preventScroll: true })
      if (document.activeElement !== target) focusFrame = requestAnimationFrame(focusMenu)
    }
    focusFrame = requestAnimationFrame(focusMenu)
    const keyboard = (event: KeyboardEvent) => {
      if (frame.current?.closest('[inert]') || event.isComposing || event.defaultPrevented || !['Escape', 'Tab'].includes(event.key)) return
      cancelAnimationFrame(focusFrame)
      setMenuOpen(false)
      event.preventDefault(); event.stopPropagation()
      const editor = frame.current?.closest<HTMLElement>('.wb-details')
      const trigger = triggerHost.current?.querySelector('button')
      if (event.key === 'Tab' && editor && trigger) {
        const items = canvasEditorFocusTargets(editor), index = items.indexOf(trigger)
        const next = items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length]
        next?.focus({ preventScroll: true })
      } else trigger?.focus({ preventScroll: true })
    }
    document.addEventListener('keydown', keyboard, true)
    return () => { cancelAnimationFrame(focusFrame); document.removeEventListener('keydown', keyboard, true) }
  }, [menuOpen, menuId, setMenuOpen])
  return <div ref={frame} className="design-editor-frame" data-design-menu-open={menuOpen}>
    <ConfigProvider componentDisabled={false}><Tabs activeKey={tab} onChange={setTab} tabBarExtraContent={onDuplicate && <Tooltip title="设计更多操作" open={menuOpen ? false : undefined}><span ref={triggerHost}><Dropdown trigger={['click']} open={menuOpen} onOpenChange={setMenuOpen} placement="bottomRight" getPopupContainer={() => document.body} overlayClassName="canvas-workbench-dialog design-editor-menu" menu={{ id: menuId, items: [{ key: 'duplicate', label: '复制为独立摄影方案', disabled }], onClick: () => { setMenuOpen(false); onDuplicate() } }}><WorkbenchButton aria-label="设计更多操作" onKeyDown={event => { if (event.key === 'ArrowDown' && !event.nativeEvent.isComposing) { event.preventDefault(); setMenuOpen(true) } }} aria-controls={menuOpen ? menuId : undefined} aria-haspopup="menu" aria-expanded={menuOpen} className="wb-icon-action" icon={<MoreOutlined />} variant="quiet" /></Dropdown></span></Tooltip>} items={[{ key: 'design', label: '设计参数' }, { key: 'references', label: '参考与关联' }]} /></ConfigProvider>
    <div hidden={tab !== 'design'}><DesignEditorActive.Provider value={tab === 'design'}><ConfigProvider componentDisabled={false}><label className="design-metadata-toggle"><Switch aria-label="显示状态与来源" checked={metadataVisible} onChange={setMetadataVisible} size="small" />显示状态与来源</label></ConfigProvider><DesignMetadataVisible.Provider value={metadataVisible}>{children}</DesignMetadataVisible.Provider></DesignEditorActive.Provider></div>
    <div hidden={tab !== 'references'} className="design-editor-references">{references}</div>
  </div>
}
