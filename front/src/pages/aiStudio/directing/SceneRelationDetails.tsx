import { useEffect, useState } from 'react'
import { Alert, Button, Modal } from 'antd'
import { StudioDirectingService } from '../../../services/generated'
import type { AssetSummary, SceneVersionContent_Output } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'
import { resolveTarget } from './SceneDesignPanel'
import type { DesignTarget } from './SceneDesignPanel'
import { DesignFields } from './DesignFields'
import { SourceLinks } from './Sources'
import { referencePurposes, referenceRoles } from './referenceInput'
import { directingError } from './common'

export type SceneInspectionTarget = { kind: 'design'; target: DesignTarget; fields?: string[] } | { kind: 'basis' | 'shared' | 'location' } | { kind: 'participant'; id: string } | { kind: 'reference'; unitId: string; id: string }

/** 就地查看当前版本的真实对象；不接受写入回调，也不切换底层编辑上下文。 */
export function SceneRelationDetails({ projectId, content, target, onClose }: {
  projectId: string; content: SceneVersionContent_Output; target: SceneInspectionTarget; onClose: () => void
}) {
  const [trigger] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : undefined)
  const close = () => {
    onClose()
    requestAnimationFrame(() => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }) })
  }
  const designPath = target.kind === 'design' ? resolveTarget(content.design, target.target) : undefined
  const participant = target.kind === 'participant' ? content.design.participants.find(row => row.id === target.id) : undefined
  const reference = target.kind === 'reference' ? content.units.find(row => row.id === target.unitId)?.references.find(row => row.id === target.id) : undefined
  const needsAssets = target.kind === 'location' || !!participant?.character_id || !!participant?.prop_id
  const [assets, setAssets] = useState<AssetSummary[]>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(needsAssets)
  const [attempt, setAttempt] = useState(0)
  const [mediaError, setMediaError] = useState(false)
  const [mediaAttempt, setMediaAttempt] = useState(0)
  useEffect(() => {
    if (!needsAssets) return
    let active = true
    setLoading(true)
    void StudioDirectingService.directingAssets({ projectId }).then(result => {
      if (!result.data) throw new Error('关联资产尚未核实')
      if (active) { setAssets(result.data); setError('') }
    }).catch(cause => { if (active) setError(directingError(cause)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, needsAssets, attempt])
  const asset = (kind: AssetSummary['kind'], id: string | null | undefined) => {
    if (!id) return <p>尚未关联{kind === 'character' ? '角色' : kind === 'scene' ? '场所' : '道具'}资产</p>
    const row = assets?.find(item => item.kind === kind && item.id === id)
    return <section><p>资产身份：{id}</p>{row ? <><p>{kind === 'character' ? '角色' : kind === 'scene' ? '场所' : '道具'}资产：{row.name}</p><p>{row.description || '尚无资产说明'}</p>
      {(loading || error) && <p>上次读取的资产信息，当前状态待核实。</p>}</> : !loading && !error && assets && <p>原资产已不可用</p>}</section>
  }
  return <Modal open title="关系对象 · 只读" rootClassName="canvas-workbench-dialog" width={720} onCancel={close}
    footer={<Button onClick={close}>返回当前工作</Button>}>
    <p>查看当前版本的对象与关联，不修改设计、参考绑定或当前选择。</p>
    {target.kind === 'basis' && <><h3>版本原文依据</h3><p style={{ whiteSpace: 'pre-wrap' }}>{content.basis.text}</p><SourceLinks sources={[content.basis.source]} /></>}
    {target.kind === 'design' && (designPath ? <DesignFields value={content.design} path={designPath} fields={target.fields} disabled onChange={() => {}} /> : <Alert type="warning" message="原设计对象已不可用，请重新选择" />)}
    {target.kind === 'shared' && <DesignFields value={content.design} path={['direction']} disabled onChange={() => {}}
      fields={['viewpoint', 'information_change', 'relationship_change', 'turning_point', 'immutable_facts', 'spatial_basis', 'shootable_area', 'axis', 'scale', 'open_questions', 'control_level']} />}
    {target.kind === 'participant' && (participant ? <><h3>{participant.name}</h3><p>参与对象身份：{participant.id}</p>{asset('character', participant.character_id)}{asset('prop', participant.prop_id)}</> : <Alert type="warning" message="原参与对象已不可用，请重新选择" />)}
    {target.kind === 'location' && asset('scene', content.design.direction.location_asset_id)}
    {needsAssets && loading && <p>正在核实关联资产</p>}
    {needsAssets && error && <Alert type="warning" message="关联资产读取失败" description={error} action={<Button loading={loading} onClick={() => setAttempt(value => value + 1)}>重试关联资产</Button>} />}
    {target.kind === 'reference' && (reference ? <><h3>单元参考</h3><p>参考用途：{referencePurposes[reference.purpose]}</p>
      <p>输入角色：{referenceRoles[reference.input_role || 'subject']}</p>
      <p>绑定对象：{reference.participant_ids.map(id => content.design.participants.find(row => row.id === id)?.name || `原对象不可用（${id}）`).join('、') || '未绑定参与对象'}</p>
      <p>文件身份：{reference.file_id}</p>{reference.asset_origin && <p>选择时资产：{reference.asset_origin.name} · {reference.asset_origin.id}</p>}
      {reference.media_kind === 'image' ? <img key={mediaAttempt} src={buildFileDownloadUrl(reference.file_id)} alt="当前参考图片" style={{ maxWidth: '100%', maxHeight: 360 }} onError={() => setMediaError(true)} /> :
        reference.media_kind === 'video' ? <video key={mediaAttempt} src={buildFileDownloadUrl(reference.file_id)} controls preload="metadata" style={{ width: '100%', maxHeight: 360 }} onError={() => setMediaError(true)} /> :
          <audio key={mediaAttempt} src={buildFileDownloadUrl(reference.file_id)} controls preload="metadata" onError={() => setMediaError(true)} />}
      {mediaError && <Alert type="warning" message="参考媒体读取失败，原绑定已保留" action={<Button onClick={() => { setMediaError(false); setMediaAttempt(value => value + 1) }}>重试参考媒体</Button>} />}
      <SourceLinks sources={[reference.source]} />
    </> : <Alert type="warning" message="原参考已不可用，请重新选择" />)}
  </Modal>
}
