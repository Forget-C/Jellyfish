import { WorkbenchModal, WorkbenchDialogActions } from './ui/WorkbenchModal'
import { WorkbenchButton } from './ui/WorkbenchButton'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Modal as AntModal, Image, Input, Pagination, Select, Space, Upload } from 'antd'
import { StudioFilesService } from '../../../services/generated'
import type { AssetSummary, FileRead, GenerationUnit_Input, ReferenceBinding_Input as Reference, SceneDesign_Input, VideoReferenceCapabilities } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'
import { directingError } from './common'
import { SourceLinks } from './Sources'
import { ReferencePreview } from './ReferencePreview'
import { referenceGroups, identityReferenceIssues, referenceIssues, referencePurposes, referenceSummary, referenceRoles } from './referenceInput'
import { shotParticipantRelations } from './productionGraph'

/** 对象与参考共用的事务式编辑弹窗；仅应用时更新单元，设计资产修改仍经过版本流程。 */
export function ReferencePicker({ rootClassName, projectId, assets, assetError, onReloadAssets, design, coverage = [], references, capability, initialParticipantIds, initialAssetId, initialRole, initialPurpose, title, contextLabel, referenceIds, inputRole: fixedInputRole, location = false, disabled = false, capabilityError, onRetryCapability, dependencyReferenceIds = [], onApply, onEditAssets, onInspectDesign, onClose }: {
  rootClassName?: string; projectId: string; assets?: AssetSummary[]; assetError?: string; onReloadAssets?: () => void; design: SceneDesign_Input;
  initialParticipantIds?: string[]; initialAssetId?: string; initialRole?: Reference['input_role']; initialPurpose?: Reference['purpose']; title?: string; contextLabel?: string; referenceIds?: string[]; inputRole?: 'first_frame' | 'last_frame' | 'subject'; location?: boolean; disabled?: boolean; capabilityError?: string; onRetryCapability?: () => void; dependencyReferenceIds?: string[];
  coverage?: GenerationUnit_Input['coverage']; references: Reference[]; capability?: VideoReferenceCapabilities; onApply: (references: Reference[]) => void; onEditAssets?: () => void; onInspectDesign?: (objectKey: string) => void; onClose: () => void;
}) {
  const Modal = rootClassName?.includes('canvas-workbench-dialog') ? WorkbenchModal : AntModal
  const SourceButton = Modal === WorkbenchModal ? WorkbenchButton : Button
  const [readingFile, setReadingFile] = useState<string>()
  const reading = useRef<HTMLElement>(null)
  const readingTrigger = useRef<HTMLElement>()
  const inspectFile = (id: string, trigger: HTMLElement) => { readingTrigger.current = trigger; setReadingFile(id) }
  useEffect(() => {
    if (readingFile) reading.current?.focus()
    else if (readingTrigger.current?.isConnected) readingTrigger.current.focus({ preventScroll: true })
  }, [readingFile])
  const [tab, setTab] = useState('assets')
  const frameScope = fixedInputRole === 'first_frame' || fixedInputRole === 'last_frame'
  const [role, setRole] = useState<NonNullable<Reference['input_role']>>(fixedInputRole || initialRole || 'subject')
  const [participantIds, setParticipantIds] = useState(initialParticipantIds || [])
  const baseline = useRef(structuredClone(references))
  const scopeIds = new Set(baseline.current.filter(ref => referenceIds ? referenceIds.includes(ref.id) : fixedInputRole ? ref.input_role === fixedInputRole : location ? ref.asset_origin?.kind === 'scene' || ref.purpose === 'space' : initialParticipantIds?.length ? ref.participant_ids.some(id => initialParticipantIds.includes(id)) : true).map(ref => ref.id))
  const groupScope = fixedInputRole === 'subject' && referenceIds !== undefined
  const groupId = useRef(baseline.current.find(ref => scopeIds.has(ref.id))?.subject_group_id || baseline.current.find(ref => scopeIds.has(ref.id))?.id || 'group-' + crypto.randomUUID().slice(0, 8))
  const [adding, setAdding] = useState(!title || title === '添加参考')
  const [choosing, setChoosing] = useState(adding || !scopeIds.size)
  const [draft, setDraft] = useState(() => structuredClone(references))
  const latest = useRef(draft); latest.current = draft
  const [replaceId, setReplaceId] = useState<string>()
  const [replacement, setReplacement] = useState<{ participantId: string; ids: string[]; token: string; references: Reference[] }>()
  const replacementRef = useRef(replacement); replacementRef.current = replacement
  const prepareReplacement = (next: typeof replacement) => { replacementRef.current = next; setReplacement(next) }
  // 原组一直保留在 draft；仅明确应用时把准备好的整组装入当前编辑内容。
  const appliedReferences = () => {
    const pending = replacementRef.current
    if (!pending?.references.length) return latest.current
    const slots = latest.current.filter(ref => pending.ids.includes(ref.id)).map(ref => ref.ordinal).sort((a, b) => a - b)
    const maximum = Math.max(-1, ...latest.current.map(ref => ref.ordinal))
    const prepared = pending.references.map((ref, index) => ({ ...ref, ordinal: slots[index] ?? maximum + index - slots.length + 1 }))
    return [...latest.current.filter(ref => !pending.ids.includes(ref.id)), ...prepared].sort((a, b) => a.ordinal - b.ordinal)
  }
  const [assetId, setAssetId] = useState(initialAssetId)
  const [purpose, setPurpose] = useState(initialPurpose)
  const selection = useRef('')
  selection.current = JSON.stringify([participantIds, assetId, role, purpose, tab, replaceId, draft.find(ref => ref.id === replaceId), replacement?.token])
  const change = (next: Reference[]) => { latest.current = next; setDraft(next) }
  const [files, setFiles] = useState<FileRead[]>([])
  const [query, setQuery] = useState('')
  const [global, setGlobal] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const active = useRef(true)
  const request = useRef(0)
  useEffect(() => { active.current = true; return () => { active.current = false; request.current++ } }, [])
  const close = () => { active.current = false; request.current++; onClose() }
  const roles = (Object.keys(referenceRoles) as NonNullable<Reference['input_role']>[]).filter(value => !capability || (value === 'subject' ? capability.subject_images || capability.subject_videos : capability.frame_roles.includes(value)))
  const scopes = coverage.map(row => ({ coverage: row, ...shotParticipantRelations(design, row.shot_id) }))
  const related = new Set(scopes.filter(row => row.known).flatMap(row => row.participants.map(person => person.id)))
  const pending = new Set(scopes.filter(row => !row.known).flatMap(row => row.participants.map(person => person.id)))
  const participantOptions = ['当前单元设计对象', '范围待核对的设计关联', '其他场内对象'].map((label, index) => ({ label, options: design.participants.filter(person => (related.has(person.id) ? 0 : pending.has(person.id) ? 1 : 2) === index).map(person => ({ value: person.id, label: person.name })) })).filter(group => group.options.length)
  const inputRole = fixedInputRole || (role && roles.includes(role) ? role : roles.includes('subject') ? 'subject' : roles[0])
  const candidates = design.participants.filter(person => related.has(person.id))
  const linked = (assets || []).filter(asset => asset.kind === 'scene' ? design.direction.location_asset_id === asset.id : candidates.some(person => (asset.kind === 'character' ? person.character_id : person.prop_id) === asset.id))
  const unavailableDefaults: string[] = []
  for (const person of candidates) {
    if (person.character_id && !(assets || []).some(asset => asset.kind === 'character' && asset.id === person.character_id)) unavailableDefaults.push(person.name + '角色')
    if (person.prop_id && !(assets || []).some(asset => asset.kind === 'prop' && asset.id === person.prop_id)) unavailableDefaults.push(person.name + '物件')
  }
  if (design.direction.location_asset_id && !(assets || []).some(asset => asset.kind === 'scene' && asset.id === design.direction.location_asset_id)) unavailableDefaults.push('本场场所')
  const matching = assetId ? (assets || []).filter(asset => asset.id === assetId) : linked.filter(asset => asset.kind === 'scene' ? location || !participantIds.length : !location && (!participantIds.length || design.participants.some(person => participantIds.includes(person.id) && (asset.kind === 'character' ? person.character_id : person.prop_id) === asset.id)))
  const load = async (next = 1, all = global) => {
    const id = ++request.current
    setLoading(true); setError('')
    try {
      const response = await StudioFilesService.listFilesApiApiV1StudioFilesGet({ projectId: all ? undefined : projectId, q: query, page: next, pageSize: 20 })
      if (!active.current || request.current !== id) return
      setFiles((response.data?.items || []).filter(file => ['image', 'video'].includes(file.type)))
      setTotal(response.data?.pagination.total || 0); setPage(next)
    } catch (cause) { if (active.current && request.current === id) setError(directingError(cause)) }
    finally { if (active.current && request.current === id) setLoading(false) }
  }
  const add = (fileId: string, kind: Reference['media_kind'], asset?: AssetSummary, chosenRole = inputRole) => {
    if (!active.current || disabled || !chosenRole) return
    if (!roles.includes(chosenRole) || kind === 'image' && chosenRole === 'subject' && capability && !capability.subject_images) {
      setError('当前模型不支持所选输入位置，请重新选择'); return
    }
    if (kind === 'audio' || (kind === 'video' && (chosenRole !== 'subject' || capability && !capability.subject_videos))) {
      setError('当前输入位置不支持此类素材，请选择图片或调整模型'); return
    }
    const pending = replacementRef.current
    if (pending && (chosenRole !== 'subject' || asset?.kind === 'scene')) { setError('更换来源仅用于当前人物或物件的身份主体参考'); return }
    const scoped = groupScope ? latest.current.find(ref => scopeIds.has(ref.id) || ref.subject_group_id === groupId.current) : undefined
    const participants = pending ? [pending.participantId] : scoped ? scoped.participant_ids : asset?.kind === 'scene' ? [] : participantIds
    const chosenPurpose = pending ? 'identity' : scoped?.purpose || purpose || (groupScope ? participants.length ? 'identity' : 'composition' : asset ? asset.kind === 'scene' ? 'space' : 'identity' : participants.length ? 'identity' : 'composition')
    const current = pending ? [...latest.current.filter(ref => !pending.ids.includes(ref.id)), ...pending.references] : latest.current
    const targetId = frameScope ? current.find(ref => ref.input_role === fixedInputRole)?.id : replaceId
    if (current.some(ref => ref.id !== targetId && ref.file_id === fileId && (!frameScope || ref.input_role === fixedInputRole) && (!groupScope || ref.subject_group_id === groupId.current || scopeIds.has(ref.id)))) return
    const replaced = current.find(ref => ref.id === targetId)
    if (replaced?.purpose === 'identity' && (replaced.input_role || 'subject') === 'subject' && (asset ? replaced.asset_origin?.kind !== asset.kind || replaced.asset_origin.id !== asset.id : !!replaced.asset_origin)) {
      setError('更换身份素材来源请使用“更换来源”，以整组替换'); return
    }
    const existing = current.find(ref => (!groupScope || scopeIds.has(ref.id) || ref.subject_group_id === groupId.current) && (ref.input_role || 'subject') === 'subject' && ref.purpose === chosenPurpose && (asset ? ref.asset_origin?.kind === asset.kind && ref.asset_origin.id === asset.id : !ref.asset_origin) && [...ref.participant_ids].sort().join() === [...participants].sort().join())
    const sameSubject = replaced && [...replaced.participant_ids].sort().join() === [...participants].sort().join() && replaced.purpose === chosenPurpose && (asset ? replaced.asset_origin?.kind === asset.kind && replaced.asset_origin.id === asset.id : !replaced.asset_origin)
    const id = 'ref-' + crypto.randomUUID().slice(0, 8)
    const added: Reference = { id: replaced?.id || id, file_id: fileId, media_kind: kind, purpose: chosenPurpose, participant_ids: participants, ordinal: replaced?.ordinal ?? Math.max(-1, ...current.map(ref => ref.ordinal)) + 1,
      input_role: chosenRole, subject_group_id: chosenRole === 'subject' ? (groupScope ? groupId.current : undefined) || (sameSubject ? replaced?.subject_group_id : undefined) || existing?.subject_group_id || existing?.id || 'group-' + crypto.randomUUID().slice(0, 8) : undefined,
      asset_origin: asset ? { kind: asset.kind, id: asset.id, name: asset.name } : undefined,
      source: { kind: 'human', reference: 'local-user', version: 'reference-1', file_id: fileId } }
    const grouped = existing && !existing.subject_group_id && chosenRole === 'subject' ? current.map(ref => ref.id === existing.id ? { ...ref, subject_group_id: added.subject_group_id } : ref) : current
    const next = replaced ? grouped.map(ref => ref.id === replaced.id ? added : ref) : [...grouped, added]
    const identityIssues = identityReferenceIssues(next, design.participants.map(person => person.id))
    if (identityIssues.length) { setError(identityIssues.join('；')); return }
    if (pending) prepareReplacement({ ...pending, references: next.filter(ref => !latest.current.some(old => old.id === ref.id)) })
    else change(next)
    setReplaceId(undefined); setError('')
    if (frameScope) setChoosing(false)
  }
  const selected = (id: string) => (replacement ? [...draft.filter(ref => !replacement.ids.includes(ref.id)), ...replacement.references] : draft).some(ref => ref.id !== replaceId && ref.file_id === id && (!frameScope || ref.input_role === fixedInputRole) && (!groupScope || scopeIds.has(ref.id) || ref.subject_group_id === groupId.current))
  const visible = (ref: Reference) => !adding && scopeIds.has(ref.id) || !baseline.current.some(old => old.id === ref.id)
  const cancelAction = <Button onClick={close}>{disabled ? '关闭' : '取消'}</Button>
  const applyAction = !disabled && <Button type="primary" onClick={() => {
    if (replacementRef.current && !replacementRef.current.references.length) { setError('请明确选入新来源的素材，或取消更换来源'); return }
    const next = appliedReferences()
    const issues = identityReferenceIssues(next, design.participants.map(person => person.id))
    if (issues.length) { setError(issues.join('；')); return }
    if (JSON.stringify(references) !== JSON.stringify(baseline.current)) { setError('当前单元输入已变化，请取消并重新打开后编辑'); return }
    try { onApply(next); close() } catch (cause) { setError(directingError(cause)) }
  }}>应用到本单元</Button>
  return <Modal rootClassName={rootClassName} title={title && title !== '添加参考' ? title : adding ? '添加参考' : '本单元参考'} zIndex={1050} open onCancel={close} width={640} styles={{ body: { maxHeight: 'min(70vh, calc(100dvh - 200px))', overflowY: 'auto' } }} footer={Modal === WorkbenchModal ? <WorkbenchDialogActions secondary={cancelAction}>{applyAction}</WorkbenchDialogActions> : <Space>{cancelAction}{applyAction}</Space>}>
    <div hidden={!!readingFile}>
    <Space direction="vertical" style={{ width: '100%' }}>
      {contextLabel && <p role="status">{contextLabel}</p>}
      {error && <Alert type="error" message={error} />}
      {fixedInputRole && <p>输入位置：{referenceRoles[fixedInputRole]}</p>}
      {fixedInputRole && !roles.includes(fixedInputRole) && <Alert type="warning" message={`当前模型不支持${referenceRoles[fixedInputRole]}，请在生成配置中更换模型；已有绑定保留。`} />}
      {!draft.length && <p>本单元尚未选入参考素材。{disabled ? '当前内容只读。' : '请明确选入素材后应用到本单元。'}</p>}
      {onEditAssets && <p>导演默认只提供候选，具体参考由本单元独立选择。<Button type="link" disabled={disabled || JSON.stringify(draft) !== JSON.stringify(baseline.current)} onClick={() => { close(); onEditAssets() }}>前往导演设置默认资产</Button></p>}
      {!!scopes.length && <details><summary>查看设计关联依据</summary><p>镜头设计范围不代表部分动作中的实际可见对象，也不代表已选入模型参考。</p>{scopes.map(row => <p key={row.coverage.id}>镜头 {design.direction.shots.findIndex(shot => shot.id === row.coverage.shot_id) + 1} · {row.known ? row.participants.map(person => design.participants.find(item => item.id === person.id)?.name || '对象引用不可用').join('、') || '明确无参与对象' : '范围待核对；现有调度与表演仅作关联依据'}{onInspectDesign && <Button type="link" disabled={disabled || JSON.stringify(draft) !== JSON.stringify(baseline.current)} onClick={() => { close(); onInspectDesign(`shot:${row.coverage.shot_id}`) }}>查看镜头设计关联</Button>}</p>)}
        {onInspectDesign && design.staging.activities.map((row, index) => initialParticipantIds?.includes(row.participant_id) && <p key={`activity:${row.id || index}`}>全场背景活动 · {row.ongoing_task.text || row.ongoing_task.reason}<Button type="link" disabled={disabled || JSON.stringify(draft) !== JSON.stringify(baseline.current)} onClick={() => { close(); onInspectDesign(`activity:${row.id || index}`) }}>查看背景依据</Button></p>)}
        {onInspectDesign && design.continuity.filter(row => row.participant_id && initialParticipantIds?.includes(row.participant_id)).map(row => <p key={row.id}>全场连续性 · {row.after.text || row.after.reason}<Button type="link" disabled={disabled || JSON.stringify(draft) !== JSON.stringify(baseline.current)} onClick={() => { close(); onInspectDesign(`continuity:${row.id}`) }}>查看连续性依据</Button></p>)}
      </details>}
      {references.some(ref => dependencyReferenceIds.includes(ref.id) && JSON.stringify(draft.find(row => row.id === ref.id)) !== JSON.stringify(ref)) && <Alert type="warning" message="本次修改涉及实际落幅依赖；应用后需要重新核对或绑定落幅。" />}
      {!capability && <Alert type="warning" message={capabilityError || "模型能力待核实；可准备参考，提交前仍需检查"} action={capabilityError && <Button onClick={onRetryCapability}>重试读取能力</Button>} />}
      {!roles.length && <Alert type="info" message="当前模型接入仅支持纯文本，请更换模型后添加参考" />}
      {identityReferenceIssues(draft, design.participants.map(person => person.id)).map(message => <Alert key={message} type="error" message={message} />)}
      {referenceIssues(appliedReferences(), capability).map(message => <Alert key={message} type="warning" message={message} />)}
      {referenceGroups(draft).filter(group => group.some(visible)).map(group => {
        const ref = group[0], ids = new Set(group.map(row => row.id))
        const identity = ref.purpose === 'identity' && (ref.input_role || 'subject') === 'subject' && ref.participant_ids.length === 1
        const update = (patch: Partial<Reference>) => change(latest.current.map(row => ids.has(row.id) ? { ...row, ...patch } : row))
        return <Card size="small" key={ref.subject_group_id || ref.id} title={ref.asset_origin?.name || '本次参考'}>
          <Space direction="vertical" style={{ width: '100%' }}>
            {identity && <SourceButton disabled={disabled || !!replacement || group.some(item => dependencyReferenceIds.includes(item.id))} onClick={() => {
              prepareReplacement({ participantId: ref.participant_ids[0], ids: group.map(item => item.id), token: crypto.randomUUID(), references: [] })
              setReplaceId(undefined); setParticipantIds(ref.participant_ids); setAssetId(undefined); setRole('subject'); setPurpose('identity'); setTab('assets'); setChoosing(true); setError('')
            }}>更换来源</SourceButton>}
            <Space wrap>{group.map(item => <Space direction="vertical" key={item.id}><ReferencePreview reference={item} />{dependencyReferenceIds.includes(item.id) && <span>此参考用于实际落幅依赖。</span>}
              {groupScope && <><span>来源：{item.asset_origin?.name || '人工素材'}</span><SourceLinks sources={[item.source]} /></>}
              <Space wrap><Button disabled={disabled || !!replacement} onClick={() => { setChoosing(true); setReplaceId(item.id); setParticipantIds(item.participant_ids); setAssetId(item.asset_origin?.id); setRole(item.input_role || 'subject'); setPurpose(item.purpose); setTab('assets') }}>更换素材</Button>
                {!frameScope && <Button disabled={disabled || !!replacement || group.indexOf(item) === 0} onClick={() => { const previous = group[group.indexOf(item) - 1]; change(latest.current.map(row => row.id === item.id ? { ...row, ordinal: previous.ordinal } : row.id === previous.id ? { ...row, ordinal: item.ordinal } : row)) }}>上移</Button>}
                <Button danger disabled={disabled || !!replacement} onClick={() => change(latest.current.filter(row => row.id !== item.id))}>移除</Button></Space>
              {references.some(old => old.id === item.id && old.file_id !== item.file_id) && <span>素材已替换，应用后更新单元。</span>}
            </Space>)}</Space>
            {ref.asset_origin && <span>素材来源：{ref.asset_origin.name} · 选择时的资产记录</span>}
            {ref.asset_origin && assets && !assets.some(asset => asset.kind === ref.asset_origin?.kind && asset.id === ref.asset_origin.id) && <p role="status">来源资产不可用；已选固定文件保留，可用性在执行前单独核实。</p>}
            <SourceLinks sources={[ref.source]} />
            <Select aria-label="参考对应人物或物件" mode="multiple" disabled={disabled || !!replacement} style={{ width: '100%' }} value={ref.participant_ids} options={design.participants.map(person => ({ value: person.id, label: person.name }))} onChange={participant_ids => update({ participant_ids })} />
            <Space wrap><Select aria-label="参考用途" disabled={disabled || !!replacement} value={ref.purpose} options={Object.entries(referencePurposes).map(([value, label]) => ({ value, label }))} onChange={purpose => update({ purpose })} />
              <Select aria-label="已选参考输入位置" disabled={disabled || !!replacement || !!fixedInputRole} value={ref.input_role || 'subject'} options={Object.entries(referenceRoles).map(([value, label]) => ({ value, label, disabled: value !== (ref.input_role || 'subject') && (group.length > 1 && value !== 'subject' || !roles.includes(value as NonNullable<Reference['input_role']>)) }))} onChange={input_role => update({ input_role, subject_group_id: input_role === 'subject' ? ref.subject_group_id || 'group-' + crypto.randomUUID().slice(0, 8) : undefined })} /></Space>
          </Space>
        </Card>
      })}
      {replacement && <Card size="small" title={`准备替换：${design.participants.find(person => person.id === replacement.participantId)?.name || '当前对象'}`}>
        <p>原身份组保留；选好新素材并应用后一次替换。其他用途和对象不受影响。</p>
        <Space wrap>{replacement.references.map(ref => <Space direction="vertical" key={ref.id}><ReferencePreview reference={ref} /><span>{ref.asset_origin?.name || '人工素材'}</span><SourceButton disabled={disabled} onClick={() => prepareReplacement({ ...replacement, references: replacement.references.filter(item => item.id !== ref.id) })}>撤回选入</SourceButton></Space>)}</Space>
        <SourceButton {...(Modal === WorkbenchModal ? { variant: 'quiet' as const } : {})} onClick={() => { prepareReplacement(undefined); setChoosing(false); setError('') }}>取消更换来源</SourceButton>
      </Card>}
      <p>拟发送：{referenceSummary(appliedReferences())}</p>
      {!fixedInputRole && adding && !!baseline.current.length && <Button onClick={() => { setAdding(false); setChoosing(false) }}>查看本单元全部参考</Button>}
      {!disabled && !choosing && (!frameScope || !draft.some(ref => ref.input_role === fixedInputRole)) && <Button onClick={() => {
        const current = groupScope ? latest.current.find(ref => scopeIds.has(ref.id) || ref.subject_group_id === groupId.current) : undefined
        if (current) { setParticipantIds(current.participant_ids); setPurpose(current.purpose); setAssetId(current.asset_origin?.id) }
        setChoosing(true)
      }}>{groupScope ? '添加组内素材' : '添加参考'}</Button>}
      {!disabled && choosing && <fieldset style={{ border: 0, padding: 0, width: '100%' }}><Space direction="vertical" style={{ width: '100%' }}>
      {replaceId && <Alert type="info" message="请选择替换素材" action={<Button onClick={() => setReplaceId(undefined)}>取消替换</Button>} />}
      <p>选择参考对象，再选入素材；默认候选不会自动选入。</p>
      {scopes.some(row => !row.known) && <Alert type="info" message="覆盖镜头的参与对象范围待核对；候选分组不代表完整出镜名单。" />}
      <Select aria-label="本次参考绑定人物或物件" disabled={!!replacement || groupScope && draft.some(ref => scopeIds.has(ref.id) || ref.subject_group_id === groupId.current)} mode="multiple" value={participantIds} placeholder="选择人物或物件" style={{ width: '100%' }} options={participantOptions} onChange={value => { setAssetId(undefined); setParticipantIds(value); setError('') }} />

      {groupScope && <Select aria-label="本次参考用途" disabled={!!replacement || draft.some(ref => scopeIds.has(ref.id) || ref.subject_group_id === groupId.current)} value={purpose || (participantIds.length ? 'identity' : 'composition')} options={Object.entries(referencePurposes).map(([value, label]) => ({ value, label }))} onChange={setPurpose} />}
      <Select aria-label="本次素材资产" allowClear placeholder="选择项目素材资产，不修改默认或参考对象" value={assetId} style={{ width: '100%' }} options={[...(assets || []).filter(asset => replacement ? asset.kind !== 'scene' : !location || asset.kind === 'scene').map(asset => ({ value: asset.id, label: asset.name })), ...(assetId && assets && !assets.some(asset => asset.id === assetId) ? [{ value: assetId, label: `${baseline.current.find(ref => ref.asset_origin?.id === assetId)?.asset_origin?.name || '原来源'}（来源不可用）`, disabled: true }] : [])]} onChange={id => { setAssetId(id); setError('') }} />
      <Select aria-label="参考素材来源" value={tab} options={[{ value: 'assets', label: '资产图片' }, { value: 'files', label: '已有素材' }, { value: 'upload', label: '上传' }]} onChange={value => { setTab(value); if (value === 'files') void load() }} />
      {!fixedInputRole && !!roles.length && <Select aria-label="参考输入位置" disabled={!!replacement} style={{ minWidth: 160 }} value={inputRole} options={roles.map(value => ({ value, label: referenceRoles[value] }))} onChange={setRole} />}
      {tab === 'assets' && <Space direction="vertical" style={{ width: '100%' }}>
          {!assets ? <Alert type={assetError ? 'error' : 'info'} message={assetError || '正在读取本场资产'} action={assetError && <Button onClick={onReloadAssets}>重试读取资产</Button>} /> : <>
            {!!unavailableDefaults.length && <Alert type="warning" message={`默认资产不可用：${unavailableDefaults.join('、')}。可独立选择其他素材。`} />}
            {!linked.length && <p>当前单元没有可用默认候选，可选择其他项目资产、已有素材或上传。</p>}
            {!!participantIds.length && !matching.some(asset => asset.kind !== 'scene') && <p>所选对象没有可用默认候选，可独立选择项目资产或其他来源。</p>}
            {matching.map(asset => <section className="scene-asset-row" key={`${asset.kind}:${asset.id}`}><strong>{asset.name}</strong><span>已选 {(asset.image_file_ids || []).filter(selected).length} 张，可新增 {(asset.image_file_ids || []).filter(id => !selected(id)).length} 张</span>
              {!asset.image_file_ids?.length && <span>尚无可用图片，请在本场资产中准备。</span>}
              {!!asset.image_file_ids?.length && asset.image_file_ids.every(selected) && <p>暂无可新增素材；已选参考可在上方管理。</p>}
              <Space wrap>{asset.image_file_ids?.map((fileId, index) => selected(fileId) ? null : <Space key={fileId} direction="vertical"><Image width={96} preview={false} src={buildFileDownloadUrl(fileId)} /><Button onClick={event => inspectFile(fileId, event.currentTarget)}>查看参考图 {index + 1}</Button>
                <Button disabled={!inputRole || !roles.includes(inputRole) || inputRole === 'subject' && capability && !capability.subject_images} onClick={() => add(fileId, 'image', asset)}>选入 {asset.name} 图片 {index + 1}</Button>
              </Space>)}</Space>
            </section>)}
          </>}
        </Space>}
        {tab === 'files' && <Space direction="vertical" style={{ width: '100%' }}>
          <Input.Search placeholder="搜索素材" value={query} onChange={event => setQuery(event.target.value)} onSearch={() => void load()} loading={loading} />
          <Select value={global ? 'all' : 'project'} options={[{ value: 'project', label: '当前项目素材' }, { value: 'all', label: '全部已有素材' }]} onChange={value => { setGlobal(value === 'all'); void load(1, value === 'all') }} />
          {files.filter(file => !selected(file.id)).map(file => <Space wrap key={file.id}>{file.type === 'image' ? <><Image width={64} preview={false} src={file.thumbnail || buildFileDownloadUrl(file.id)} /><Button onClick={event => inspectFile(file.id, event.currentTarget)}>查看图片：{file.name}</Button></> : <span>视频</span>}<span>{file.name}</span>
            <Button disabled={!inputRole || !roles.includes(inputRole)} onClick={() => add(file.id, file.type as Reference['media_kind'])}>选入</Button></Space>)}
          <Button onClick={() => void load(page)} loading={loading}>刷新素材</Button><Pagination size="small" current={page} total={total} pageSize={20} onChange={next => void load(next)} />
        </Space>}
        {tab === 'upload' && <><p>上传只添加本次参考，不创建项目资产。</p><Upload accept={frameScope ? "image/*" : "image/*,video/*"} disabled={!inputRole || !roles.includes(inputRole)} showUploadList={false} beforeUpload={file => {
          const chosenRole = inputRole
          const scope = selection.current
          void StudioFilesService.uploadFileApiApiV1StudioFilesUploadPost({ formData: { file: file as unknown as string, project_id: projectId, usage_kind: 'upload' } }).then(response => { if (response.data && active.current && scope === selection.current) add(response.data.id, response.data.type as Reference['media_kind'], undefined, chosenRole) }).catch(cause => { if (active.current && scope === selection.current) setError(directingError(cause)) })
          return false
        }}><Button disabled={!inputRole || !roles.includes(inputRole)}>上传参考素材</Button></Upload></>}
      </Space></fieldset>}
    </Space>
    </div>
    {readingFile && <section ref={reading} tabIndex={-1} aria-label="参考图片 · 只读"><Button onClick={() => setReadingFile(undefined)}>返回参考选择</Button><img src={buildFileDownloadUrl(readingFile)} alt="参考图片" style={{ maxWidth: '100%' }} /></section>}
  </Modal>
}
