import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Spin } from 'antd'
import { ApiError, StudioDirectingService } from '../../../services/generated'
import type { InstructionBasisConfirm, InstructionBasisRead, InstructionInputs_Output as InstructionInputs, SceneVersionContent_Output } from '../../../services/generated'
import { DesignFields } from './DesignFields'
import { SourceLinks } from './Sources'
import { directingError } from './common'

/** 旧依据和当前依据都来自服务端实际输入投影，查看不修改当前内容。 */
export function BasisInputs({ title, value }: { title: string; value: InstructionInputs }) {
  return <section aria-label={title}><h4>{title}</h4>
    <p>原文：{value.basis.text}</p><SourceLinks sources={[value.basis.source]} />
    <p>动作：{value.unit.coverage.map(item => item.action_scope).join('；')}</p>
    <p>模型：{value.video_model_name || '未选择'} · {value.unit.ratio} · {value.unit.duration_ms == null ? '时长未填写' : `${value.unit.duration_ms / 1000} 秒`}</p>
    <p>参数：{Object.entries(value.unit.parameters).map(([name, parameter]) => `${name}=${String(parameter)}`).join('；') || '默认参数'}</p>
    <p>参考：{value.unit.references.map(item => `${item.asset_origin?.name || item.file_id}（${item.input_role || '未记录输入角色'}）`).join('；') || '无'}</p>
    <p>风格：{value.style_rules.map(rule => rule.requirement).join('；') || '无适用规则'}</p>
    <details><summary>查看相关设计与来源</summary><DesignFields value={value.design} path={[]} disabled onChange={() => {}} /></details>
    <details><summary>查看固定关联身份</summary>
      {value.unit.coverage.map(item => <p key={item.id}>镜头：{item.shot_id}；节拍：{item.beat_ids.join('、') || '无'}；事件：{item.event_ids.join('、') || '无'}</p>)}
      {value.unit.references.map(item => <p key={item.id}>文件：{item.file_id}；用途：{item.purpose}；绑定对象：{item.participant_ids.join('、') || '无'}</p>)}
      {(value.unit.scene_dependencies || []).map(link => <p key={`${link.version_id}:${link.clip_id}`}>来源版本：{link.version_id}；采用：{link.clip_id}；实际落幅：{link.frame_id || '未绑定'}；参考输入：{link.reference_id || '未绑定'}</p>)}
      {value.unit.dependencies.map((item, index) => <p key={index}>前段：{item.plan_revision_id}／{item.unit_id}；实际落幅：{item.frame_id || '未绑定'}</p>)}
    </details>
  </section>
}

/** 明确确认仅更新依据引用；保存、浏览及重复核对不会静默改变绑定。 */
export function SceneInstructionBasis({ projectId, sequenceId, versionId, unitId, revision, content, disabled, onChange }: {
  projectId: string; sequenceId: string; versionId: string; unitId: string; revision: number
  content: SceneVersionContent_Output; disabled: boolean; onChange: (value: SceneVersionContent_Output) => void
}) {
  const target = { projectId, sequenceId, versionId, unitId }
  const storageKey = `jellyfish:instruction-basis:${projectId}:${sequenceId}:${versionId}:${unitId}`
  const snapshotKey = JSON.stringify(content)
  const [checked, setChecked] = useState<{ key: string; value: InstructionBasisRead }>()
  const [pending, setPending] = useState<InstructionBasisConfirm>()
  const [readError, setReadError] = useState('')
  const [storageError, setStorageError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const mounted = useRef(true)
  const live = useRef({ content, disabled })
  live.current = { content, disabled }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      const request = saved ? JSON.parse(saved) as InstructionBasisConfirm : undefined
      if (request && (!request.request_id || !request.content?.units || !Number.isInteger(request.expected_revision))) throw new Error('原依据确认记录无法读取')
      setPending(request); setStorageError('')
    } catch (cause) { setStorageError(directingError(cause)) }
  }, [storageKey, attempt])
  useEffect(() => {
    let active = true
    setReadError('')
    const timer = setTimeout(() => {
      void StudioDirectingService.directingInstructionBasis({ ...target, requestBody: { content } }).then(result => {
        if (!result.data) throw new Error('指令依据状态尚未核实')
        if (active) setChecked({ key: snapshotKey, value: result.data })
      }).catch(cause => { if (active) setReadError(directingError(cause)) })
    }, 200)
    return () => { active = false; clearTimeout(timer) }
  }, [snapshotKey, attempt])
  const state = checked?.key === snapshotKey ? checked.value : undefined
  const clearPending = (id: string) => {
    const saved = localStorage.getItem(storageKey)
    if (saved && (JSON.parse(saved) as InstructionBasisConfirm).request_id === id) localStorage.removeItem(storageKey)
    if (mounted.current) setPending(previous => previous?.request_id === id ? undefined : previous)
  }
  const confirm = async () => {
    if (busy || live.current.disabled || storageError) return
    const request = pending || { request_id: crypto.randomUUID(), expected_revision: revision, content: structuredClone(live.current.content) }
    try { localStorage.setItem(storageKey, JSON.stringify(request)); setPending(request) }
    catch { setError('无法保存确认恢复记录，尚未提交'); return }
    setBusy(true); setError('')
    try {
      const result = await StudioDirectingService.directingConfirmInstructionBasis({ ...target, requestBody: request })
      if (!result.data?.basis_id) throw new Error('依据确认结果尚未核实')
      clearPending(request.request_id)
      if (!mounted.current) return
      const current = live.current.content
      const unit = current.units.find(item => item.id === unitId)
      if (!unit || live.current.disabled || unit.instruction !== request.content.units?.find(item => item.id === unitId)?.instruction) throw new Error('原确认已完成，但正文已变化，请重新核对后确认')
      const candidate = { ...current, units: current.units.map(item => item.id === unitId ? { ...item, instruction_basis_id: result.data!.basis_id } : item) }
      const verified = await StudioDirectingService.directingInstructionBasis({ ...target, requestBody: { content: candidate } })
      if (!mounted.current) return
      if (live.current.disabled || live.current.content !== current || verified.data?.status !== 'current') throw new Error('确认期间内容或依据已变化，未应用回执，请重新核对')
      onChange(candidate)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && cause.status !== 408) {
        try { clearPending(request.request_id) } catch { /* 保留原记录供同一次请求核实。 */ }
      }
      if (mounted.current) setError(directingError(cause))
    } finally { if (mounted.current) setBusy(false) }
  }
  return <section aria-label="指令依据核对">
    {!state && !readError && <p><Spin size="small" /> 正在核对指令依据</p>}
    {readError && <Alert type="error" message="指令依据读取失败" description={readError} action={<Button onClick={() => setAttempt(value => value + 1)}>重试依据读取</Button>} />}
    {storageError && <Alert type="error" message={storageError} action={<Button onClick={() => setAttempt(value => value + 1)}>重试恢复记录</Button>} />}
    {error && <Alert type="error" message={error} />}
    {state && <Alert type={state.status === 'changed' ? 'warning' : 'info'} message={({ empty: '先填写指令正文', unbound: '指令依据尚未确认', current: '指令依据一致，尚不代表检查通过', changed: '指令依据已变' })[state.status]} />}
    {state?.status === 'changed' && <p>旧正文已保留。请查看差异，人工修订或生成新建议后明确确认；仅保存不会解除提示。</p>}
    {state?.previous && <details><summary>查看新旧依据</summary><BasisInputs title="原确认依据" value={state.previous} /><BasisInputs title="当前依据" value={state.current} /></details>}
    {pending && <p>保留了尚未核实的原确认请求；核实不会自动确认后来修改的内容。</p>}
    {(pending || state && state.status !== 'empty' && state.status !== 'current') && <Button disabled={disabled || busy || !!storageError || !pending && (!state || !!readError)} onClick={() => void confirm()}>
      {pending ? '核实原依据确认' : '确认已按当前依据核对正文'}
    </Button>}
  </section>
}
