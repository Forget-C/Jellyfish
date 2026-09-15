import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Image, Input, Modal, Select, Space, Spin, Tabs, Tag, Typography } from 'antd'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { StudioDirectingService } from '../../../services/generated'
import type { DirectingTaskRead, ProductionPlan_Input, SceneDesign_Input, WorkspaceRead } from '../../../services/generated'
import { DesignEditor } from './DesignEditor'
import { ReviewDetails } from './ReviewDetails'
import { StyleEditor } from './StyleEditor'
import { SceneAssets } from './SceneAssets'
import { VisualPanel } from './VisualPanel'
import { ContinuityPanel } from './ContinuityPanel'
import { PlanEditor } from './PlanEditor'
import { BatchPanel } from './BatchPanel'
import { RegroupPanel } from './RegroupPanel'
import { LedgerPanel } from './LedgerPanel'
import { FeedbackPanel } from './FeedbackPanel'
import { CutEditor } from './CutEditor'
import { DirectingTasks } from './DirectingTasks'
import { emptyDesign } from './designTemplate'
import { directingError } from './common'
import { buildFileDownloadUrl } from '../assets/utils'

type DesignRevision = WorkspaceRead['designs'][number]
type PlanRevision = WorkspaceRead['plans'][number]
const roles: Record<string, string> = { direction: '总导演', performance: '表演指导', staging: '镜内执行', cinematography: '摄影指导', continuity: '场记', prompt: '提示词指导' }

/** 场次设计、试拍和粗剪共享上下文；本地编辑保留起始版本避免覆盖并发修改。 */
export default function SequenceWorkspacePage() {
  const { projectId = '', chapterId = '', sequenceId = '' } = useParams()
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()
  const [workspace, setWorkspace] = useState<WorkspaceRead>()
  const [baseDesign, setBaseDesign] = useState<DesignRevision>()
  const [editingSequenceVersion, setEditingSequenceVersion] = useState<number>()
  const [design, setDesign] = useState<SceneDesign_Input>()
  const [basePlan, setBasePlan] = useState<PlanRevision>()
  const [plan, setPlan] = useState<ProductionPlan_Input>()
  const [promptId, setPromptId] = useState<string>()
  const [reviewId, setReviewId] = useState<string>()
  const [unitId, setUnitId] = useState<string>()
  const [instruction, setInstruction] = useState('')
  const [result, setResult] = useState<DirectingTaskRead>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const loaded = useRef('')
  const currentSequence = useRef(sequenceId)
  currentSequence.current = sequenceId
  const requestIdentity = useRef<{ prompt: string; review: string; request: string }>()
  /** 只在明确选择或保存时加载编辑基线，轮询不覆盖本地工作单。 */
  const selectDesign = useCallback((revision?: DesignRevision, sequenceVersion?: number) => { setEditingSequenceVersion(sequenceVersion); setBaseDesign(revision); setDesign(revision ? structuredClone(revision.content) : undefined) }, [])
  const selectPlan = useCallback((revision?: PlanRevision) => { setBasePlan(revision); setPlan(revision ? structuredClone(revision.content) : undefined); setUnitId(revision?.content.units[0]?.id) }, [])
  /** 状态轮询只更新服务端上下文，编辑版本保持独立。 */
  const reload = useCallback(async () => {
    try {
      const response = await StudioDirectingService.directingWorkspace({ projectId, sequenceId })
      if (!response.data || currentSequence.current !== sequenceId) return
      setWorkspace(response.data)
      if (loaded.current !== sequenceId) {
        loaded.current = sequenceId
        selectDesign(response.data.designs.slice(-1)[0], response.data.sequence.version); selectPlan(response.data.plans.slice(-1)[0])
        setEditingSequenceVersion(response.data.sequence.version);
        setPromptId(response.data.prompts.slice(-1)[0]?.id); setReviewId(response.data.reviews.slice(-1)[0]?.id)
      }
    } catch (cause) { setError(directingError(cause)) }
  }, [projectId, sequenceId, selectDesign, selectPlan])
  useEffect(() => { void reload() }, [reload])
  /** 业务按钮共用错误和运行状态，但不自动授权下一步。 */
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action() } catch (cause) { setError(directingError(cause)) } finally { setBusy(false) }
  }
  /** 保存或派生设计，保留用户开始编辑时的版本。 */
  const saveDesign = () => run(async () => {
    if (!design) return
    const response = await StudioDirectingService.directingSaveRevision({ projectId, sequenceId, requestBody: { document: { kind: 'design', content: design }, sequence_version: editingSequenceVersion,
      ...(baseDesign?.confirmed_at ? { parent_id: baseDesign.id } : baseDesign ? { revision_id: baseDesign.id, expected_version: baseDesign.version } : {}) } })
    if (response.data) {
      setWorkspace(response.data)
      selectDesign(baseDesign && !baseDesign.confirmed_at ? response.data.designs.find(row => row.id === baseDesign.id) : response.data.designs.slice(-1)[0], response.data.sequence.version)
    }
  })
  /** 生产计划与设计分开确认；参考变化会生成新的计划版本。 */
  const savePlan = () => run(async () => {
    if (!plan) return
    const response = await StudioDirectingService.directingSaveRevision({ projectId, sequenceId, requestBody: { document: { kind: 'plan', content: plan },
      ...(basePlan?.confirmed_at ? { parent_id: basePlan.id } : basePlan ? { revision_id: basePlan.id, expected_version: basePlan.version } : {}) } })
    if (response.data) { setWorkspace(response.data); selectPlan(basePlan && !basePlan.confirmed_at ? response.data.plans.find(row => row.id === basePlan.id) : response.data.plans.slice(-1)[0]) }
  })
  if (!workspace || workspace.sequence.id !== sequenceId) return <Space direction="vertical"><Spin />{error && <Alert type="error" message={error} />}</Space>
  const selectedPrompt = workspace.prompts.find(row => row.id === promptId)
  const frozenPlan = workspace.plans.find(row => row.id === selectedPrompt?.content.plan_revision_id)
  const frozenUnit = frozenPlan?.content.units.find(unit => unit.id === selectedPrompt?.content.unit_id)
  const selectedReview = workspace.reviews.find(row => row.id === reviewId && row.content.occurrences.every(item => item.prompt_revision_id === promptId))
  const planDesign = workspace.designs.find(row => row.id === plan?.design_revision_id)
  const designDirty = !!design && JSON.stringify(design) !== JSON.stringify(baseDesign?.content)
  const planDirty = !!plan && JSON.stringify(plan) !== JSON.stringify(basePlan?.content)
  const latestDesign = workspace.designs.find(row => row.id === baseDesign?.id)
  const designStale = !!baseDesign && !!latestDesign && (baseDesign.version !== latestDesign.version || baseDesign.confirmed_at !== latestDesign.confirmed_at)
  const latestPlan = workspace.plans.find(row => row.id === basePlan?.id)
  const planStale = !!basePlan && !!latestPlan && (basePlan.version !== latestPlan.version || basePlan.confirmed_at !== latestPlan.confirmed_at)
  return <Space direction="vertical" size="large" style={{ width: '100%', padding: 24 }}>
    <Space wrap><Button onClick={() => navigate(`/projects/${projectId}/chapters/${chapterId}/sequences`)}>返回场次列表</Button><Typography.Title level={3} style={{ margin: 0 }}>{workspace.sequence.title}</Typography.Title><Button onClick={reload}>刷新状态</Button></Space>
    {error && <Alert type="error" message={error} closable onClose={() => setError('')} />}
    {workspace.sequence.source_changed && <Alert type="warning" message="章节原文已变化。请回场次列表核对范围后再生成新设计。" />}
    <Card size="small" title="本场原文"><Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }} ellipsis={{ rows: 4, expandable: true }}>{workspace.sequence.source_text}</Typography.Paragraph></Card>
    <Tabs activeKey={search.get('view') || 'design'} onChange={view => setSearch({ view })} items={[
      { key: 'design', label: '导演设计', children: <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Space wrap><Select placeholder="选择设计版本" value={baseDesign?.id} style={{ minWidth: 240 }} options={workspace.designs.map((row, index) => ({ value: row.id, label: `设计 ${index + 1} · ${row.confirmed_at ? '已确认' : '草稿'} · 修订 ${row.version}` }))} onChange={id => selectDesign(workspace.designs.find(row => row.id === id), workspace.sequence.version)} />
          <Button onClick={() => { setBaseDesign(undefined); setEditingSequenceVersion(workspace.sequence.version); setDesign(emptyDesign()) }}>手动起稿</Button></Space>
        <Input.TextArea placeholder="本场希望观众看到什么？也可填写对现有设计的修改意见。" value={instruction} onChange={event => setInstruction(event.target.value)} />
        <Button loading={busy} disabled={designDirty || designStale || workspace.sequence.source_changed} onClick={() => run(async () => {
          await StudioDirectingService.directingGenerateDesign({ projectId, sequenceId, requestBody: { instruction, style_revision_id: design?.style_revision_id, revision_id: baseDesign?.id, expected_version: baseDesign?.version } }); await reload()
        })}>生成导演建议</Button>
        {designDirty && <Typography.Text type="warning">请先保存本地修改，再生成建议或确认设计。</Typography.Text>}
        {designStale && <Alert type="warning" message={`当前编辑修订 ${baseDesign!.version}，服务器版本已更新。`} action={<Button onClick={() => selectDesign(latestDesign, workspace.sequence.version)}>放弃本地编辑并载入最新设计</Button>} />}
        {baseDesign && !baseDesign.source_current && <Alert type="warning" message="此设计依据的场次范围已变化，请核对内容后保存为当前来源的设计。" />}
        {design && <><SceneAssets projectId={projectId} sequenceId={sequenceId} design={design} onChange={setDesign} /><StyleEditor projectId={projectId} sequenceId={sequenceId} value={design.style_revision_id} onChange={id => setDesign({ ...design, style_revision_id: id })} /><DesignEditor value={design} onChange={setDesign} />
          <Space><Button type="primary" loading={busy} onClick={saveDesign}>{baseDesign?.confirmed_at ? '保存为新设计版本' : '保存设计草稿'}</Button>
            <Button disabled={!baseDesign || !!baseDesign.confirmed_at || designDirty || designStale} loading={busy} onClick={() => run(async () => {
              const response = await StudioDirectingService.directingConfirmRevision({ projectId, sequenceId, revisionId: baseDesign!.id, requestBody: { expected_version: baseDesign!.version } })
              if (response.data) { setWorkspace(response.data); selectDesign(response.data.designs.find(row => row.id === baseDesign!.id), response.data.sequence.version) }
            })}>确认本轮设计</Button>
            {baseDesign?.confirmed_at && <Button onClick={() => {
              setBasePlan(undefined); setPlan({ design_revision_id: baseDesign.id, units: [] }); setSearch({ view: 'shoot' })
            }}>为此设计准备试拍</Button>}</Space></>}
      </Space> },
      { key: 'shoot', label: '单元试拍', children: <Space direction="vertical" style={{ width: '100%' }} size="large">
        {basePlan && <RegroupPanel key={basePlan.id} projectId={projectId} sequenceId={sequenceId} plan={basePlan} disabled={!basePlan.confirmed_at || planDirty || planStale} onChange={next => { setWorkspace(next); selectPlan(next.plans.slice(-1)[0]); setPromptId(undefined); setReviewId(undefined) }} />}
        <Space wrap><Select placeholder="选择生产计划" value={basePlan?.id} style={{ minWidth: 240 }} options={workspace.plans.map((row, index) => ({ value: row.id, label: `计划 ${index + 1} · ${row.confirmed_at ? '已确认' : '草稿'}` }))} onChange={id => selectPlan(workspace.plans.find(row => row.id === id))} />
          <Select placeholder="从已确认设计创建新计划" style={{ minWidth: 240 }} value={undefined} options={workspace.designs.filter(row => row.confirmed_at).map((row, index) => ({ value: row.id, label: `设计 ${index + 1}` }))} onChange={id => { setBasePlan(undefined); setPlan({ design_revision_id: id!, units: [] }) }} /></Space>
        {planStale && <Alert type="warning" message={`当前编辑计划修订 ${basePlan!.version}，服务器版本已更新。`} action={<Button onClick={() => selectPlan(latestPlan)}>放弃本地编辑并载入最新计划</Button>} />}
        {plan && planDesign ? <><PlanEditor projectId={projectId} workspace={workspace} design={planDesign.content} value={plan} onChange={setPlan} />
          <Space><Button type="primary" loading={busy} disabled={!plan.units.length} onClick={savePlan}>{basePlan?.confirmed_at ? '保存为新生产计划' : '保存生产计划'}</Button>
            <Button disabled={!basePlan || !!basePlan.confirmed_at || planDirty || planStale} loading={busy} onClick={() => run(async () => {
              const response = await StudioDirectingService.directingConfirmRevision({ projectId, sequenceId, revisionId: basePlan!.id, requestBody: { expected_version: basePlan!.version } })
              if (response.data) { setWorkspace(response.data); selectPlan(response.data.plans.find(row => row.id === basePlan!.id)) }
            })}>确认本次单元与参考</Button></Space>
          {basePlan?.confirmed_at && <Space><Select aria-label="选择编译单元" style={{ minWidth: 260 }} value={unitId} options={basePlan.content.units.map((unit, index) => ({ value: unit.id, label: `单元 ${index + 1} · ${unit.coverage.map(c => c.action_scope).join('；')}` }))} onChange={setUnitId} />
            <Button disabled={!unitId || planDirty} loading={busy} onClick={() => run(async () => {
              const response = await StudioDirectingService.directingCompile({ projectId, sequenceId, requestBody: { plan_revision_id: basePlan.id, unit_id: unitId! } })
              if (response.data) { setWorkspace(response.data); setPromptId(response.data.prompts.slice(-1)[0]?.id); setReviewId(undefined) }
            })}>编译本次试拍</Button></Space>}</> : <Alert type="info" message="先确认导演设计，再创建拍摄单元。" />}
        {workspace.prompts.length > 0 && <Card title="本次执行文本">
          <Space direction="vertical" style={{ width: '100%' }}><Select style={{ width: '100%' }} value={promptId} placeholder="选择提示词版本" options={workspace.prompts.map((row, index) => ({ value: row.id, label: `提示词 ${index + 1} · ${row.content.unit_id}` }))} onChange={id => { setPromptId(id); setReviewId(undefined) }} />
            {frozenUnit && <Card size="small" title="已固定的试拍输入">
              <p>模型：{frozenUnit.model_id} · 时长：{frozenUnit.duration_ms / 1000} 秒 · 画幅：{frozenUnit.ratio} · 种子：{String(frozenUnit.parameters?.seed ?? '自动')}</p>
              {frozenUnit.coverage.map(item => <p key={item.id}>{item.shot_id}：{item.action_scope}</p>)}
              <Space wrap>{[...frozenUnit.references].sort((a, b) => a.ordinal - b.ordinal).map(ref => <Space direction="vertical" key={ref.id}><Image width={96} src={buildFileDownloadUrl(ref.file_id)} /><span>参考 {ref.ordinal + 1} · {ref.input_role} · {ref.purpose}</span><span>{ref.participant_ids.join('、') || '整体画面'}</span></Space>)}</Space>
            </Card>}
            <Input.TextArea readOnly autoSize={{ minRows: 6, maxRows: 18 }} value={selectedPrompt?.content.text} />
            {selectedPrompt && <details><summary>编译来源与去向</summary>{selectedPrompt.content.decisions.map((decision, index) => <p key={index}>{decision.section_path} → {decision.text_excerpt || decision.explanation}</p>)}</details>}
            <Button disabled={!promptId} loading={busy} onClick={() => run(async () => { await StudioDirectingService.directingReview({ projectId, sequenceId, promptId: promptId!, requestBody: {} }); await reload() })}>六部门审稿</Button>
          </Space>
        </Card>}
        {workspace.reviews.length > 0 && <Card title="审稿与执行确认"><Space direction="vertical" style={{ width: '100%' }}>
          <Select style={{ width: '100%' }} value={selectedReview?.id} placeholder="选择本次审稿" options={workspace.reviews.filter(row => row.content.occurrences.every(o => o.prompt_revision_id === promptId)).map((row, index) => ({ value: row.id, label: `审稿 ${index + 1}${row.parent_id ? ' · 含人工裁决' : ''}` }))} onChange={setReviewId} />
          {selectedReview?.content.rows.map(row => <Card key={row.role + row.occurrence_id} size="small" title={<Space>{roles[row.role]}<Tag color={row.verdict === 'pass' ? 'green' : 'orange'}>{row.verdict === 'pass' ? '通过' : row.verdict === 'pending' ? '待审' : '需修改'}</Tag></Space>}>
            <ReviewDetails row={row} />
            {row.verdict === 'revise' && <Button onClick={() => { let reason = ''; Modal.confirm({ title: '接受此艺术偏离并记录理由', content: <Space direction="vertical" className="w-full"><ReviewDetails row={row} /><Input.TextArea placeholder="说明为什么保留当前方案；结构和模型能力校验仍不可绕过" onChange={event => { reason = event.target.value }} /></Space>, onOk: async () => {
              const response = await StudioDirectingService.directingResolveReview({ projectId, sequenceId, reviewId: selectedReview.id, requestBody: { role: row.role, occurrence_id: row.occurrence_id, reason } })
              if (response.data) { setWorkspace(response.data); setReviewId(response.data.reviews.slice(-1)[0]?.id) }
            } }) }}>记录人工取舍</Button>}
          </Card>)}
          <Typography.Text type="secondary">执行将使用所选提示词版本固定的模型、范围和参考。新素材仅登记为候选，不自动加入粗剪。</Typography.Text>
          <Button type="primary" loading={busy} disabled={!selectedPrompt || !selectedReview || selectedReview.content.rows.some(row => row.verdict !== 'pass')} onClick={() => run(async () => {
            if (!requestIdentity.current || requestIdentity.current.prompt !== promptId || requestIdentity.current.review !== reviewId) requestIdentity.current = { prompt: promptId!, review: reviewId!, request: crypto.randomUUID() }
            await StudioDirectingService.directingShoot({ projectId, sequenceId, requestBody: { prompt_revision_id: promptId!, review_revision_id: reviewId!, request_id: requestIdentity.current.request } })
            requestIdentity.current = undefined; await reload()
          })}>确认并开始试拍</Button>
        </Space></Card>}
      </Space> },
      { key: 'continuity', label: '实际连续性', children: <ContinuityPanel key={sequenceId} projectId={projectId} workspace={workspace} /> },
      { key: 'batch', label: '批量拍摄', children: <BatchPanel key={sequenceId} projectId={projectId} workspace={workspace} onSubmitted={reload} /> },
      { key: 'visual', label: '视觉验证', children: <VisualPanel projectId={projectId} workspace={workspace} onSubmitted={reload} /> },
      { key: 'ledger', label: '三本账', children: <LedgerPanel key={sequenceId} projectId={projectId} sequenceId={sequenceId} /> },
      { key: 'feedback', label: '场次验收与返工', children: <FeedbackPanel key={sequenceId} projectId={projectId} workspace={workspace} onRefresh={reload} /> },
      { key: 'cut', label: '审片与粗剪', children: <CutEditor key={workspace.sequence.id} projectId={projectId} workspace={workspace} onChange={setWorkspace} /> },
    ]} />
    <DirectingTasks projectId={projectId} taskIds={workspace.task_ids} onSettled={reload} onResult={setResult} />
    <Modal title={result?.image_file_ids?.length ? '验证图候选' : result?.design ? '导演建议' : '审稿结果'} open={!!result} width={900} onCancel={() => setResult(undefined)} footer={result?.image_file_ids?.length ? null : <Button type="primary" loading={busy} onClick={() => run(async () => {
      if (!result) return
      const response = result.design
        ? await StudioDirectingService.directingApplyDesign({ projectId, sequenceId, requestBody: { task_id: result.task_id } })
        : await StudioDirectingService.directingApplyReview({ projectId, sequenceId, requestBody: { task_id: result.task_id } })
      if (response.data) {
        setWorkspace(response.data)
        if (result.design) { selectDesign(response.data.designs.slice(-1)[0], response.data.sequence.version); setSearch({ view: 'design' }) }
        else {
          const applied = response.data.reviews.slice(-1)[0]
          setReviewId(applied?.id); setPromptId(applied?.content.occurrences[0]?.prompt_revision_id); setSearch({ view: 'shoot' })
        }
      }
      setResult(undefined)
    })}>{result?.design ? '采用为可编辑草稿' : '保存审稿结论'}</Button>}>
      {!!result?.image_file_ids?.length && <><Typography.Paragraph>候选图已保存到本项目素材。请在生产计划中明确选择，才会加入本次参考；不会自动替换已确认素材。</Typography.Paragraph>{result.image_file_ids.map(id => <Image key={id} src={buildFileDownloadUrl(id)} alt="验证图候选" />)}</>}
      {result?.design && <DesignEditor value={result.design} onChange={() => {}} disabled />}
      {result?.review?.rows.map(row => <Card key={row.role + row.occurrence_id} size="small" title={`${roles[row.role]} · ${row.verdict === 'pass' ? '通过' : row.verdict === 'pending' ? '待审' : '需修改'}`}><ReviewDetails row={row} /></Card>)}
    </Modal>
  </Space>
}
