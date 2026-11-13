import { useEffect, useState } from 'react'
import { Alert, Button, Modal, Spin } from 'antd'
import { StudioDirectingService, type CharacterComposition } from '../../../services/generated'
import { AssetLibrarySelect } from './AssetLibrarySelect'
import { directingError } from './common'

/** 编辑项目共享组合；保存不生成图片，也不替换任何已选对象参考。 */
export function CharacterCompositionEditor({ projectId, characterId, onClose, onSaved }: {
  projectId: string; characterId: string; onClose: () => void; onSaved: () => Promise<unknown>
}) {
  const [draft, setDraft] = useState<CharacterComposition>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setError(''); setDraft(undefined)
    void StudioDirectingService.directingCharacterComposition({ projectId, characterId }).then(response => {
      if (active && response.data) setDraft(response.data)
    }).catch(cause => { if (active) setError(directingError(cause)) })
    return () => { active = false }
  }, [projectId, characterId, retry])
  const save = async () => {
    if (!draft || busy) return
    setBusy(true); setError('')
    try {
      const response = await StudioDirectingService.directingSaveCharacterComposition({ projectId, characterId,
        requestBody: { expected_revision: draft.revision, actor_id: draft.actor_id, costume_id: draft.costume_id, prop_ids: draft.prop_ids },
      })
      if (!response.data) throw new Error('保存结果待核实，请重试保存相同组合')
      setDraft(response.data)
      await onSaved()
      onClose()
    } catch (cause) { setError(directingError(cause)) }
    finally { setBusy(false) }
  }
  return <Modal title="角色组合" open onCancel={() => { if (!busy) onClose() }} maskClosable={false}
    footer={<><Button disabled={busy} onClick={onClose}>取消</Button><Button type="primary" loading={busy} disabled={!draft} onClick={() => void save()}>保存组合</Button></>}>
    <p>修改会影响本项目使用该角色的后续读取与生成</p>
    <p>已有参考图保持原选择。保存后可进入“准备图片”生成角色图，再明确选为本场参考。</p>
    {error && <Alert type="error" message={error} action={<Button disabled={busy} onClick={() => setRetry(count => count + 1)}>重新读取</Button>} />}
    {!draft && !error && <Spin />}
    {draft && <div style={{ display: 'grid', gap: 16 }}>
      <AssetLibrarySelect kind="actor" label="组合演员" value={draft.actor_id ?? undefined} disabled={busy}
        onChange={value => setDraft({ ...draft, actor_id: typeof value === 'string' ? value : null })} />
      <AssetLibrarySelect kind="costume" label="组合服装" value={draft.costume_id ?? undefined} disabled={busy}
        onChange={value => setDraft({ ...draft, costume_id: typeof value === 'string' ? value : null })} />
      <AssetLibrarySelect kind="prop" label="组合道具" multiple value={draft.prop_ids} disabled={busy}
        onChange={value => setDraft({ ...draft, prop_ids: Array.isArray(value) ? value : [] })} />
    </div>}
  </Modal>
}
