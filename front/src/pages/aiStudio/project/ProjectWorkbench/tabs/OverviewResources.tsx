import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button, Skeleton } from 'antd'
import { useUiText } from '../../../../../uiText'
import { StudioEntitiesService } from '../../../../../services/generated'
import { resolveAssetUrl } from '../../../assets/utils'
import { projectNavigationGroups, projectResourceKinds as kinds, projectTabLocation } from '../constants'
import type { ProjectResourceKind } from './ProjectResourcesTab'

const categories = projectNavigationGroups.flatMap(group => group.items).filter(
  (item): item is typeof item & { key: keyof typeof kinds } => Object.prototype.hasOwnProperty.call(kinds, item.key),
)

type Resource = { id: string; name: string; thumbnail?: string | null; created_at?: string | null }
type Summary = { total?: number; items: Resource[]; failed?: boolean }

export function OverviewResources({ projectId, refresh, onOpen }: {
  projectId: string
  refresh: number
  onOpen: (kind: ProjectResourceKind, id: string, trigger: HTMLElement) => void
}) {
  const uiText = useUiText()
  const [results, setResults] = useState<Partial<Record<ProjectResourceKind, Summary>>>({})
  const [selected, setSelected] = useState<keyof typeof kinds>()
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    for (const { key } of categories) {
      const entityType = kinds[key]
      void StudioEntitiesService.listEntitiesApiV1StudioEntitiesEntityTypeGet({
        entityType, projectId, page: 1, pageSize: 3, order: 'created_at', isDesc: true,
      }).then(({ data }) => {
        if (!data?.items || data.items.some(item => item.project_id !== projectId)) throw new Error()
        const total = data.pagination?.total
        return { items: data.items, total: Number.isSafeInteger(total) && total >= data.items.length ? total : undefined }
      }).catch(() => ({ items: [], failed: true })).then(summary => {
        if (active) setResults(previous => ({ ...previous, [entityType]: summary }))
      })
    }
    return () => { active = false }
  }, [projectId, refresh, retry])

  const loading = categories.some(({ key }) => !results[kinds[key]])
  const failed = Object.values(results).some(result => result.failed)
  const category = categories.find(item => item.key === selected)
  const visibleCategories = category ? [category] : categories
  const recent = visibleCategories.flatMap(category => (results[kinds[category.key]]?.items ?? []).flatMap(resource => {
    const created = Date.parse(resource.created_at ?? '')
    return Number.isFinite(created) ? [{ resource, category, created }] : []
  })).sort((a, b) => b.created - a.created).slice(0, 3)

  return <div className="overview-resource-body" aria-busy={loading}>
    <div className="overview-resource-toolbar">
      <div className="overview-resource-filters" role="group" aria-label={uiText("资源分类")}>
        <button type="button" aria-pressed={!selected} onClick={() => setSelected(undefined)}>{uiText("全部")}</button>
        {categories.map(({ key, label }) => {
          const result = results[kinds[key]]
          return <button type="button" key={key} aria-pressed={selected === key} onClick={() => setSelected(key)}>
            {uiText(label)}{' '}
            {!result ? <Skeleton.Input active size="small" /> : <span title={result.total === undefined ? uiText("数量待确认") : undefined}>{result.total ?? '—'}</span>}
          </button>
        })}
      </div>
      <div className="overview-resource-actions">
        {failed && !loading && <Button size="small" type="link" onClick={() => setRetry(value => value + 1)}>{uiText("重试读取资源")}</Button>}
        {category ? <Link to={projectTabLocation(projectId, category.key)}>
          {uiText("查看全部{{category}}", { category: uiText(category.label) })}
        </Link> : <span>{uiText("按新增时间")}</span>}
      </div>
    </div>
    <div className="overview-recent-resources">
      {loading ? <ul aria-hidden="true">{[0, 1, 2].map(slot => <li key={slot}><Skeleton avatar active title={false} paragraph={{ rows: 1 }} /></li>)}</ul>
        : recent.length ? <ul aria-label={uiText("资源预览")}>{recent.map(({ resource, category }) =>
          <li key={`${category.key}:${resource.id}`}>
            <button type="button" onClick={event => onOpen(kinds[category.key], resource.id, event.currentTarget)} title={resource.name}>
              <ResourceThumbnail key={resource.thumbnail} source={resolveAssetUrl(resource.thumbnail ?? undefined)} icon={category.icon} />
              <span><strong>{resource.name}</strong><small>{uiText(category.label)}</small></span>
            </button>
          </li>)}</ul>
          : <p className="overview-message">{uiText(visibleCategories.every(({ key }) => results[kinds[key]]?.total === 0)
            ? (category ? "该分类暂无资源" : "暂无项目资源") : "暂无可展示的最近资源")}</p>}
    </div>
  </div>
}

function ResourceThumbnail({ source, icon }: { source?: string; icon: ReactNode }) {
  const [failed, setFailed] = useState(false)
  return <span className="overview-resource-thumb" aria-hidden="true">
    {source && !failed ? <img src={source} alt="" onError={() => setFailed(true)} /> : icon}
  </span>
}
