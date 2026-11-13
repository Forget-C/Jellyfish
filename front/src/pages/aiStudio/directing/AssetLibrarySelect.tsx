import { useEffect, useState } from 'react'
import { Alert, Button, Select } from 'antd'
import { StudioEntitiesService } from '../../../services/generated'
import { directingError } from './common'

type Item = { id: string; name: string }
/** 在选择处检索共享资产；浏览不创建项目关联，分页保留已选身份。 */
export function AssetLibrarySelect({ kind, label, value, multiple, disabled, onChange }: {
  kind: 'actor' | 'scene' | 'prop' | 'costume'; label: string
  value?: string | string[]; multiple?: boolean; disabled?: boolean
  onChange: (value: string | string[] | undefined) => void
}) {
  const [selectedNames, setSelectedNames] = useState<Record<string, string>>({})
  const [namesError, setNamesError] = useState('')
  const [namesRetry, setNamesRetry] = useState(0)
  const selectedKey = JSON.stringify(typeof value === 'string' ? [value] : value ?? [])
  useEffect(() => {
    let active = true
    setNamesError('')
    const ids = JSON.parse(selectedKey) as string[]
    void Promise.allSettled(ids.map(id => StudioEntitiesService.getEntityApiV1StudioEntitiesEntityTypeEntityIdGet({ entityType: kind, entityId: id }))).then(results => {
      if (!active) return
      const names: Record<string, string> = {}
      results.forEach((result, index) => {
        const data = result.status === 'fulfilled' ? result.value.data as Item | undefined : undefined
        names[ids[index]] = data?.name ?? '资产名称读取失败'
        if (!data) setNamesError('已选资产名称读取失败，请重新读取后核对')
      })
      setSelectedNames(names)
    })
    return () => { active = false }
  }, [kind, selectedKey, namesRetry])
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setBusy(true); setError('')
    const timer = window.setTimeout(async () => {
      try {
        const response = await StudioEntitiesService.listEntitiesApiV1StudioEntitiesEntityTypeGet({
          entityType: kind, q: query || null, page, pageSize: 30, order: 'name', isDesc: false,
        })
        if (!active) return
        const data = response.data
        const next = (data?.items ?? []) as Item[]
        setItems(previous => page === 1 ? next : [...previous, ...next])
        setMore(page * 30 < (data?.pagination?.total ?? 0))
      } catch (cause) { if (active) { setError(directingError(cause)); setOpen(false) } }
      finally { if (active) setBusy(false) }
    }, 200)
    return () => { clearTimeout(timer); active = false }
  }, [kind, query, page, retry])
  const selected = typeof value === 'string' ? [value] : value ?? []
  const options = items.map(item => ({ value: item.id, label: item.name }))
  for (const id of selected) if (!options.some(option => option.value === id)) options.push({ value: id, label: selectedNames[id] ?? '读取资产名称…' })
  return <div>
    <Select aria-label={label} placeholder={label} style={{ width: '100%' }} showSearch filterOption={false}
      open={open} onDropdownVisibleChange={setOpen} allowClear mode={multiple ? 'multiple' : undefined} value={value} options={options} disabled={disabled}
      loading={busy} onSearch={text => { if (text !== query) { setQuery(text); setPage(1) } }} onChange={onChange}
      dropdownRender={menu => <>{menu}
        {more && !error && <Button disabled={busy} onMouseDown={event => event.preventDefault()} onClick={() => setPage(count => count + 1)}>加载更多</Button>}</>} />
    {namesError && <Alert type="warning" message={namesError} action={<Button onClick={() => setNamesRetry(count => count + 1)}>重读名称</Button>} />}
    {error && <Alert type="error" message={error} action={<Button onMouseDown={event => event.preventDefault()} onClick={() => setRetry(count => count + 1)}>重试</Button>} />}
  </div>
}
