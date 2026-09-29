import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Drawer, Image, Input, Pagination, Select, Space, Tabs, Upload } from 'antd'
import { StudioFilesService } from '../../../services/generated'
import type { AssetSummary, FileRead, ReferenceBinding_Input as Reference, SceneDesign_Input, VideoReferenceCapabilities } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'
import { directingError } from './common'
import { referenceRoles } from './referenceInput'

/** 当前单元的选图入口；关联和资产编辑仍由本场资产面板负责。 */
export function ReferencePicker({ projectId, assets, assetError, onReloadAssets, design, references, capability, onAdd, onClose }: {
  projectId: string; assets?: AssetSummary[]; assetError?: string; onReloadAssets?: () => void; design: SceneDesign_Input;
  references: Reference[]; capability?: VideoReferenceCapabilities; onAdd: (reference: Reference) => void; onClose: () => void;
}) {
  const [tab, setTab] = useState('assets')
  const [role, setRole] = useState<NonNullable<Reference['input_role']>>()
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
  const roles = (Object.keys(referenceRoles) as NonNullable<Reference['input_role']>[]).filter(value => !capability || (value === 'subject' ? capability.subject_images || capability.subject_videos : capability.frame_roles.includes(value)))
  const inputRole = role || (roles.includes('subject') ? 'subject' : roles[0])
  const linked = (assets || []).filter(asset => asset.kind === 'scene' ? design.direction.location_asset_id === asset.id : design.participants.some(person => (asset.kind === 'character' ? person.character_id : person.prop_id) === asset.id))
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
    if (!active.current || !chosenRole) return
    if (!roles.includes(chosenRole) || kind === 'image' && chosenRole === 'subject' && capability && !capability.subject_images) {
      setError('当前模型不支持所选输入位置，请重新选择'); return
    }
    if (kind === 'audio' || (kind === 'video' && (chosenRole !== 'subject' || capability && !capability.subject_videos))) {
      setError('当前输入位置不支持此类素材，请选择图片或调整模型'); return
    }
    const participants = asset ? design.participants.filter(person => (asset.kind === 'character' ? person.character_id : asset.kind === 'prop' ? person.prop_id : null) === asset.id).map(person => person.id) : []
    const purpose = asset ? asset.kind === 'scene' ? 'space' : 'identity' : 'composition'
    const existing = asset && references.find(ref => ref.input_role === 'subject' && ref.subject_group_id && ref.purpose === purpose && ref.asset_origin?.kind === asset.kind && ref.asset_origin.id === asset.id && ref.asset_origin.name === asset.name && [...ref.participant_ids].sort().join() === [...participants].sort().join())
    const id = 'ref-' + crypto.randomUUID().slice(0, 8)
    onAdd({ id, file_id: fileId, media_kind: kind, purpose, participant_ids: participants, ordinal: references.length,
      input_role: chosenRole, subject_group_id: chosenRole === 'subject' ? existing?.subject_group_id || 'group-' + crypto.randomUUID().slice(0, 8) : undefined,
      asset_origin: asset ? { kind: asset.kind, id: asset.id, name: asset.name } : undefined,
      source: { kind: 'human', reference: 'local-user', version: 'reference-1', file_id: fileId } })
  }
  const selected = (id: string) => references.some(ref => ref.file_id === id)
  return <Drawer title="添加参考" zIndex={1050} open onClose={onClose} width="min(640px, 100vw)" extra={<Button onClick={onClose}>完成选择</Button>}>
    <Space direction="vertical" style={{ width: '100%' }}>
      <p>选入当前单元使用的图片。本场关联不会自动提交图片。</p>
      {error && <Alert type="error" message={error} />}
      {!capability && <Alert type="warning" message="模型能力待核实；可准备参考，提交前仍需检查" />}
      {!roles.length ? <Alert type="info" message="当前模型接入仅支持纯文本，请更换模型后添加参考" /> : <Select aria-label="参考输入位置" style={{ minWidth: 160 }} value={inputRole} options={roles.map(value => ({ value, label: referenceRoles[value] }))} onChange={setRole} />}
      <Tabs activeKey={tab} onChange={value => { setTab(value); if (value === 'files') void load() }} items={[
        { key: 'assets', label: '本场资产', children: <Space direction="vertical" style={{ width: '100%' }}>
          {!assets ? <Alert type={assetError ? 'error' : 'info'} message={assetError || '正在读取本场资产'} action={assetError && <Button onClick={onReloadAssets}>重试读取资产</Button>} /> : <>
            {!linked.length && <p>此计划依据的设计尚未关联资产，也可从已有素材选择或上传。</p>}
            {linked.map(asset => <section className="scene-asset-row" key={`${asset.kind}:${asset.id}`}><strong>{asset.name}</strong>
              {!asset.image_file_ids?.length && <span>尚无可用图片，请在本场资产中准备。</span>}
              <Space wrap>{asset.image_file_ids?.map((fileId, index) => <Space key={fileId} direction="vertical"><Image width={96} src={buildFileDownloadUrl(fileId)} />
                <Button disabled={!inputRole || selected(fileId) || inputRole === 'subject' && capability && !capability.subject_images} onClick={() => add(fileId, 'image', asset)}>选入 {asset.name} 图片 {index + 1}</Button>
              </Space>)}</Space>
            </section>)}
          </>}
        </Space> },
        { key: 'files', label: '已有素材', children: <Space direction="vertical" style={{ width: '100%' }}>
          <Input.Search placeholder="搜索素材" value={query} onChange={event => setQuery(event.target.value)} onSearch={() => void load()} loading={loading} />
          <Select value={global ? 'all' : 'project'} options={[{ value: 'project', label: '当前项目素材' }, { value: 'all', label: '全部已有素材' }]} onChange={value => { setGlobal(value === 'all'); void load(1, value === 'all') }} />
          {files.map(file => <Space wrap key={file.id}>{file.type === 'image' ? <Image width={64} src={file.thumbnail || buildFileDownloadUrl(file.id)} /> : <span>视频</span>}<span>{file.name}</span>
            <Button disabled={!inputRole || selected(file.id)} onClick={() => add(file.id, file.type as Reference['media_kind'])}>选入</Button></Space>)}
          <Button onClick={() => void load(page)} loading={loading}>刷新素材</Button><Pagination size="small" current={page} total={total} pageSize={20} onChange={next => void load(next)} />
        </Space> },
        { key: 'upload', label: '上传', children: <><p>上传只添加本次参考，不创建项目资产。</p><Upload accept="image/*,video/*" disabled={!inputRole} showUploadList={false} beforeUpload={file => {
          const chosenRole = inputRole
          void StudioFilesService.uploadFileApiApiV1StudioFilesUploadPost({ formData: { file: file as unknown as string, project_id: projectId, usage_kind: 'upload' } }).then(response => { if (response.data && active.current) add(response.data.id, response.data.type as Reference['media_kind'], undefined, chosenRole) }).catch(cause => { if (active.current) setError(directingError(cause)) })
          return false
        }}><Button disabled={!inputRole}>上传参考素材</Button></Upload></> },
      ]} />
    </Space>
  </Drawer>
}
