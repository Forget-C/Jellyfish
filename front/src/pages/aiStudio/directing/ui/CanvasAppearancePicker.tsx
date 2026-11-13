import { Dropdown, Radio } from 'antd'
import { BgColorsOutlined, CheckOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { canvasAppearances, useAppStore } from '../../../../store/useAppStore'
import { WorkbenchIconButton } from './WorkbenchButton'

/** 两种画布和设置页共享个人配色偏好，不进入画布历史。 */
export function CanvasAppearancePicker({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation('layout')
  const value = useAppStore(state => state.canvasAppearance)
  const setValue = useAppStore(state => state.setCanvasAppearance)
  const label = t('canvasAppearance.label')
  const option = (key: typeof value) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span aria-hidden style={{ width: 20, height: 14, border: '1px solid #8392a5', borderRadius: 3, background: key === 'dark' ? '#0d0d0d' : key === 'mist' ? 'linear-gradient(125deg,#f0f5fc,#f7f8fb)' : key === 'solid' ? '#f7f8fb' : 'linear-gradient(90deg,#f0f5fc 50%,#0d0d0d 50%)' }} />{t(`canvasAppearance.${key}`)}{compact && value === key && <CheckOutlined aria-hidden />}</span>
  if (!compact) return <div role="radiogroup" aria-label={label}><Radio.Group className="app-appearance-options" value={value} onChange={event => setValue(event.target.value)}>{canvasAppearances.map(key => <Radio key={key} value={key}>{option(key)}</Radio>)}</Radio.Group></div>
  return <Dropdown autoFocus trigger={['click']} menu={{ selectable: true, selectedKeys: [value], items: canvasAppearances.map(key => ({ key, label: option(key), role: 'menuitemradio', 'aria-checked': key === value, onClick: () => setValue(key) })) }}><WorkbenchIconButton label={label} icon={<BgColorsOutlined />} variant="quiet" /></Dropdown>
}
