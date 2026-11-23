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
  const recent = categories.flatMap(category => (results[kinds[category.key]]?.items ?? []).flatMap(resource => {
    const created = Date.parse(resource.created_at ?? '')
    return Number.isFinite(created) ? [{ resource, category, created }] : []
  })).sort((a, b) => b.created - a.created).slice(0, 3)

  return <div className="overview-resource-body" aria-busy={loading}>
    <ul className="overview-resource-counts">
      {categories.map(({ key, label }) => {
        const result = results[kinds[key]]
        return <li key={key}><Link to={projectTabLocation(projectId, key)}>
          <span>{uiText(label)}</span>
          {!result ? <Skeleton.Input active size="small" /> : <strong>{result.total ?? uiText("数量待确认")}</strong>}
        </Link></li>
      })}
    </ul>
    <div className="overview-recent-resources">
      <div className="overview-recent-heading">
        <h3>{uiText("最近新增")}</h3>
        {failed && !loading && <Button size="small" type="link" onClick={() => setRetry(value => value + 1)}>{uiText("重试读取资源")}</Button>}
      </div>
      {loading ? <Skeleton active title={false} paragraph={{ rows: 2 }} />
        : recent.length ? <ul>{recent.map(({ resource, category }) =>
          <li key={`${category.key}:${resource.id}`}>
            <button type="button" onClick={event => onOpen(kinds[category.key], resource.id, event.currentTarget)} title={resource.name}>
              <ResourceThumbnail key={resource.thumbnail} source={resolveAssetUrl(resource.thumbnail ?? undefined)} icon={category.icon} />
              <span><strong>{resource.name}</strong><small>{uiText(category.label)}</small></span>
            </button>
          </li>)}</ul>
          : <p className="overview-message">{uiText(categories.every(({ key }) => results[kinds[key]]?.total === 0)
            ? "暂无项目资源" : "暂无可展示的最近资源")}</p>}
    </div>
  </div>
}

function ResourceThumbnail({ source, icon }: { source?: string; icon: ReactNode }) {
  const [failed, setFailed] = useState(false)
  return <span className="overview-resource-thumb" aria-hidden="true">
    {source && !failed ? <img src={source} alt="" onError={() => setFailed(true)} /> : icon}
  </span>
}
