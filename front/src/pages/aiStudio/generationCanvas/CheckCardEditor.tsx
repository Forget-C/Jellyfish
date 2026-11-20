import { CheckStatus } from './CheckStatus'
import { CaretRightOutlined } from '@ant-design/icons'
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Alert, ConfigProvider, Input, Select, Switch, Tooltip, theme } from 'antd'
import type { CanvasCheckItem, CanvasCheckReportRead, CheckCard } from '../../../services/generated'
import { WorkbenchButton as Button } from '../../../components/workbench/WorkbenchButton'
import { WorkbenchDialogActions } from '../../../components/workbench/WorkbenchModal'
import { CanvasEditorFooter, CanvasEditorTitle } from './CanvasCardEditor'
import { CanvasEditorTabs } from './CanvasEditorTabs'
import { PostCheckPanel } from './PostCheckPanel'
import { BasisDetails, CheckReportDetails } from './CheckReportDetails'
import { checkApplicability, reportPending, useCheckCard } from './CheckCardSession'
import './checkCard.css'

export function checkReportLabel(report: CanvasCheckReportRead) {
  const time = new Date(report.created_at).toLocaleString('zh-CN', { hour12: false })
  const subject = report.product ? `产物 ${report.product.position + 1} · 运行 ${report.product.run_id.slice(0, 8)}` : `目标 ${report.basis.target_card_id.slice(0, 8)}`
  return `${time} · ${report.automatic ? '自动生成后' : report.product ? '生成后' : '生成前'} · ${report.recheck ? '复核' : report.scope === 'item' ? '单项' : '整卡'} · ${subject}`
}

/** 配置变化提示针对选中的历史报告，不改变历史结论及其固定依据。 */
function ReportChanges({ report }: { report: CanvasCheckReportRead }) {
  const { savedCard, comparable, basis, items } = useCheckCard()
  const saved = savedCard?.type === 'review.check' ? savedCard as CheckCard : undefined
  const config = report.configuration
  const sorted = (values?: string[]) => JSON.stringify([...(values || [])].sort())
  const rangeChanged = saved && config && (sorted(config.categories) !== sorted(report.product ? saved.post_check_categories : saved.enabled_categories)
    || sorted(config.disabled_items) !== sorted(saved.disabled_items?.filter(id => id.startsWith('R') === !!report.product))
    || !report.product && JSON.stringify(Object.entries(config.scope_notes).sort()) !== JSON.stringify(Object.entries(saved.scope_notes || {}).sort()))
  const enabled = items.filter(item => item.enabled).map(item => item.id)
  const selectionChanged = !report.product && comparable && basis?.target_card_id === report.basis.target_card_id && report.enabled_item_ids
    && (enabled.length !== report.enabled_item_ids.length || report.enabled_item_ids.some(id => !enabled.includes(id)))
  return <>
    {selectionChanged && !rangeChanged && <p role="status">当前启用项目与报告生成时不同。此报告只覆盖当时执行的项目。</p>}
    {saved && (saved.check_model_id ?? null) !== (report.check_model_id ?? null) && <p role="status">当前检查模型与本报告使用的模型不同。</p>}
    {rangeChanged && <p role="status">当前检查范围设置与本报告不同。</p>}
    {saved && config && report.product && !!saved.auto_post_check !== !!config.auto_post_check && <p role="status">当前自动检查开关与本报告的配置不同。</p>}
  </>
}

/** 单会话的详情投影；页签浏览不会提交任务或替换正在阅读的报告。 */
export function CheckCardEditor() {
  const state = useCheckCard()
  const { card, items, categories, reports, basis, selectedCategories, included, disabled, running, cancelling,
    loading, blocked, ready, comparable, projectId, canvasId, cardId, savedRevision, editorOpen, documentPending,
    automaticCheckRunId, onChange, run, cancel, showReport, itemName, itemState, latest, tab, setTab } = state
  const footer = useContext(CanvasEditorFooter)
  const visible = useContext(CanvasEditorTitle)?.open ?? !!editorOpen
  const { token } = theme.useToken()
  const owner = useRef<HTMLElement>(null)
  const [expanded, setExpanded] = useState<string[]>([])
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const scrollPositions = useRef<Record<string, number>>({})
  const handledItem = useRef<typeof state.itemTarget>()
  const { reportFilter: filter, setReportFilter: setFilter } = state
  const models = (state.models || []).filter(model => model.category === 'text')
  const modelOptions = models.map(model => ({ value: model.id, label: model.name }))
  if (card.check_model_id && !models.some(model => model.id === card.check_model_id)) modelOptions.push({ value: card.check_model_id, label: '已保存的模型暂不可用' })
  const visibleReports = reports.filter(report => filter === 'all' || (filter === 'post') === !!report.product)
  const selectedId = state.selectedReportId
  const { reportSelection } = state
  const selectedItemId = reportSelection?.itemId
  const report = selectedId ? visibleReports.find(row => row.id === selectedId) : visibleReports[0]
  const hasReportItem = !selectedItemId || !!report?.items.some(item => item.id === selectedItemId)
    || !!report?.omitted?.some(item => item.item_id === selectedItemId)
  const pending = state.currentPending
  const firstVisibleId = visibleReports[0]?.id
  const selectReport = state.setSelectedReportId
  useEffect(() => {
    if (tab === 'history' && !selectedId && firstVisibleId) selectReport(firstVisibleId)
  }, [tab, selectedId, firstVisibleId, selectReport])
  const recheck = { projectId, canvasId, disabled: disabled || cancelling, onReport: showReport }
  // The retained editor may be display:none while another card is open.
  useLayoutEffect(() => {
    if (!visible) return
    const page = owner.current?.querySelector<HTMLElement>('.ant-tabs-tabpane-active .canvas-editor-tab-page')
    if (page) page.scrollTop = scrollPositions.current[tab] ?? 0
  }, [tab, visible])
  useLayoutEffect(() => {
    if (reportSelection?.itemId) {
      scrollPositions.current.history = 0
      const page = owner.current?.querySelector<HTMLElement>('.ant-tabs-tabpane-active .canvas-editor-tab-page')
      if (page) page.scrollTop = 0
    }
  }, [reportSelection])

  const targetItem = items.find(item => item.id === state.itemTarget?.id)
  useLayoutEffect(() => {
    const target = state.itemTarget
    if (!target || target === handledItem.current || !targetItem || !visible || tab !== 'pre') return
    const frame = requestAnimationFrame(() => {
      const row = owner.current?.querySelector<HTMLElement>(`[data-check-item="${CSS.escape(target.id)}"]`)
      if (!row?.getClientRects().length) return
      handledItem.current = target
      row.scrollIntoView({ block: 'nearest' })
      row.querySelector<HTMLElement>('.generation-check-item-title')?.focus({ preventScroll: true })
    })
    setOpenGroups(previous => previous[targetItem.category] === true ? previous : { ...previous, [targetItem.category]: true })
    setExpanded(previous => previous.includes(target.id) ? previous : [...previous, target.id])
    return () => cancelAnimationFrame(frame)
  }, [state.itemTarget, targetItem, visible, tab])
  const applicability = (selected: CanvasCheckReportRead) => (item: typeof items[number] | undefined) => comparable
    ? checkApplicability(item, items.find(row => row.id === item?.id), selected.basis.target_card_id === basis?.target_card_id)
    : '待核对当前检查依据'
  const sourceAction = (item: CanvasCheckItem, historical = false) => state.canLocateSource(item)
    ? <Button size="small" variant="quiet" onClick={() => state.onLocateDesign?.(item.source.card_id, item.field_id)}>{historical ? '定位当前来源' : '定位来源'}</Button>
    : <small>当前来源不可定位</small>
  const updateScope = (id: string, value: string) => {
    const notes = { ...card.scope_notes }
    if (value.trim()) notes[id] = value
    else delete notes[id]
    onChange({ ...card, scope_notes: notes })
  }
  const action = <WorkbenchDialogActions className="generation-check-actions" secondary={<div role="status">{state.reason || `本次已启用 ${state.enabledItems.length} 项`}{pending && <small>本轮完成 {pending.executions?.filter(row => !['queued', 'running'].includes(row.status)).length || 0}／{pending.executions?.length || 0} 项模型检查</small>}</div>}>
    {pending ? <Button loading={cancelling} disabled={disabled || cancelling || pending.executions?.every(row => !['queued', 'running'].includes(row.status) || row.cancel_requested)} onClick={() => void cancel(pending.id)}>取消本轮检查</Button>
      : <Button variant="primary" loading={running} disabled={blocked || !ready} onClick={() => void run()}>{reports.some(row => !row.product) ? '重新检查' : '检查'}</Button>}
  </WorkbenchDialogActions>
  const pre = <section className="canvas-editor-tab-page generation-check-page" aria-label="生成前检查">
    <div className="generation-check-intro"><span>仅核对本次采用的要求，结论供生成决策参考。</span><Button variant="quiet" size="small" disabled={loading || running || documentPending} onClick={state.refresh}>刷新检查依据</Button></div>
    {basis && <BasisDetails basis={basis} label="生成检查依据" />}
    {state.itemTarget && !targetItem && !loading && <p role="status">指定检查项暂不可用</p>}
    {!items.length && <p>{state.reason || '当前没有适用检查项'}</p>}
    {categories.map(category => {
      const children = items.filter(item => item.category === category.id)
      const enabled = selectedCategories.includes(category.id)
      const groupOpen = openGroups[category.id] ?? children.length > 0
      const attentionCount = children.filter(item => ['明确问题', '无法判断', '执行失败', '待重查', '风险建议'].includes(itemState(item))).length
      return <section key={category.id} aria-label={category.label} className="generation-check-category">
        <div className="generation-check-category-heading">
          <Button variant="quiet" className="generation-check-item-title" title={category.label} aria-expanded={groupOpen}
            onClick={() => setOpenGroups(previous => ({ ...previous, [category.id]: !groupOpen }))}
            icon={<CaretRightOutlined rotate={groupOpen ? 90 : 0} />}>{category.label}</Button>
          <small>启用 {enabled ? children.filter(item => included(item.id)).length : 0}／{children.length}{attentionCount > 0 && ` · 待关注 ${attentionCount}`}</small>
          <Switch size="small" aria-label={`启用类别：${category.label}`} checked={enabled} disabled={disabled || running} onChange={checked => onChange({ ...card, enabled_categories: checked ? [...new Set([...selectedCategories, category.id])] : selectedCategories.filter(id => id !== category.id) })} />
        </div>
        <div hidden={!groupOpen} className="generation-check-category-content">
          {category.availability !== 'ready' && <p>{category.availability === 'not_applicable' ? '不适用' : '暂不可执行'} · {category.reason}</p>}
          {children.map(item => {
            const previous = latest(item.id)
            const checking = state.itemChecking(item)
            return <div key={item.id} className="generation-check-item" data-check-item={item.id}>
              <div className="generation-check-item-heading">
                <Switch size="small" aria-label={`纳入整卡检查：${itemName(item)}`} checked={included(item.id)} disabled={disabled || running} onChange={checked => onChange({ ...card, disabled_items: checked ? (card.disabled_items || []).filter(id => id !== item.id) : [...(card.disabled_items || []), item.id] })} />
                <Button variant="quiet" className="generation-check-item-title" title={itemName(item)} aria-expanded={expanded.includes(item.id)}
                  onClick={() => setExpanded(previous => previous.includes(item.id) ? previous.filter(id => id !== item.id) : [...previous, item.id])}
                  icon={<CaretRightOutlined rotate={expanded.includes(item.id) ? 90 : 0} />}>{itemName(item)}</Button>
                <CheckStatus status={itemState(item)} />
                <Button size="small" disabled={blocked || checking || item.availability === 'unavailable'} aria-label={`${previous ? '重新检查此项' : '检查此项'}：${itemName(item)}`} onClick={() => void run(item.id)}>{previous ? '重新检查此项' : '检查此项'}</Button>
              </div>
              <div className="generation-check-item-body" hidden={!expanded.includes(item.id)}>
                <p className="generation-check-requirement">{item.requirement}</p>
                {sourceAction(item)}
                {!enabled || !included(item.id) ? <p>未纳入整卡检查，仍可明确执行单项检查。</p> : null}
                {item.availability === 'unavailable' && <p>{item.reason}</p>}
                {item.scope_editable && <label>检查范围说明<Input.TextArea rows={2} maxLength={500} disabled={disabled || running} value={card.scope_notes?.[item.id] || ''} onChange={event => updateScope(item.id, event.currentTarget.value)} /></label>}
                {previous && <div className="generation-check-item-result"><strong>最近检查结果</strong><CheckReportDetails report={previous} itemId={item.id} applicability={applicability(previous)} recheck={recheck} />
                  <Button size="small" variant="quiet" onClick={() => state.openReport(previous.id, item.id)}>查看对应报告</Button></div>}
              </div>
            </div>
          })}
        </div>
      </section>
    })}
  </section>
  const history = <section className="canvas-editor-tab-page generation-check-page generation-check-report" aria-label="检查报告">
    <label>记录范围<Select aria-label="检查记录筛选" value={filter} onChange={value => { setFilter(value); state.setSelectedReportId(reports.find(row => value === 'all' || (value === 'post') === !!row.product)?.id) }} options={[{ value: 'all', label: '全部' }, { value: 'pre', label: '生成前' }, { value: 'post', label: '生成后' }]} /></label>
    {visibleReports.length > 0 && <label>检查报告<Select aria-label="选择检查报告" placeholder="请选择检查报告" value={report?.id} onChange={selectReport} options={visibleReports.map(entry => ({ value: entry.id, label: checkReportLabel(entry) }))} /></label>}
    {report ? <>
      <ReportChanges report={report} />
      {reportPending(report) && <Button size="small" loading={cancelling} disabled={disabled || cancelling} onClick={() => void cancel(report.id)}>取消本轮检查</Button>}
      {hasReportItem ? <CheckReportDetails report={report} itemId={selectedItemId} showContext active={visible && tab === 'history'} models={state.models} applicability={report.product ? undefined : applicability(report)} recheck={recheck}
        sourceAction={item => sourceAction(item, true)}
        retry={id => !report.product && items.some(item => item.id === id && item.availability === 'ready') && <Button size="small" disabled={blocked} onClick={() => void run(id)}>重新检查此项</Button>} />
        : <p role="status">指定报告条目暂不可用</p>}
      {selectedItemId && <Button variant="quiet" onClick={() => selectReport(report.id)}>查看整份报告</Button>}
      {reports[0] && report.id !== reports[0].id && <Button variant="quiet" onClick={() => { setFilter('all'); state.openReport(reports[0].id) }}>查看最新报告</Button>}
    </> : <p role="status">{selectedId ? loading ? '正在读取指定报告' : '指定报告暂不可用' : '暂无此范围的检查记录'}</p>}
  </section>
  const targetName = state.cardName(state.targetId)
  return <ConfigProvider componentDisabled={false}><section ref={owner} className="generation-check-editor" aria-label="检查卡配置" onScrollCapture={event => {
    const page = event.target
    if (page instanceof HTMLElement && page.matches('.ant-tabs-tabpane-active .canvas-editor-tab-page') && page.getClientRects().length) {
      scrollPositions.current[tab] = page.scrollTop
    }
  }}>
    <div className="generation-check-settings">
      <p>生成目标 <Tooltip title={targetName} trigger={['hover', 'focus', 'click']}><span tabIndex={0}>{targetName}</span></Tooltip></p>
      <label>检查模型<Select aria-label="文字检查模型" placeholder="请选择独立的检查模型" allowClear disabled={disabled || running} value={card.check_model_id ?? undefined} options={modelOptions} onChange={value => onChange({ ...card, check_model_id: value ?? null })} /></label>
    </div>
    {state.error && <Alert type="warning" showIcon message={state.error} action={<Button size="small" onClick={state.refresh}>刷新</Button>} />}
    <ConfigProvider theme={{ components: { Switch: { colorPrimary: token.colorTextSecondary, colorPrimaryHover: token.colorText } } }}>
      <CanvasEditorTabs activeKey={tab} onChange={setTab} items={[
        { key: 'pre', label: '生成前检查', forceRender: true, children: pre },
        { key: 'post', label: '生成后检查', forceRender: true, children: <PostCheckPanel projectId={projectId} canvasId={canvasId} cardId={cardId} savedRevision={savedRevision}
          active={!!editorOpen && tab === 'post'} disabled={!!disabled || !!documentPending || cancelling} reports={reports} onReport={showReport}
          card={card} updateCard={onChange} configDisabled={!!disabled || cancelling} automaticCheckRunId={automaticCheckRunId}
          automaticWaitExpired={state.automaticWaitExpired} targetReportId={state.postTarget?.reportId} targetSerial={state.postTarget?.serial} onOpenReport={state.openReport} onCancel={cancel} cancelling={cancelling}
          onRefreshReports={state.refresh} /> },
        { key: 'history', label: '检查记录', forceRender: true, children: history },
      ]} />
    </ConfigProvider>
    {tab === 'pre' && (footer ? createPortal(action, footer) : action)}
  </section></ConfigProvider>
}
