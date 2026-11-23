import { useUiText } from '../../../../../uiText'
import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRightOutlined } from '@ant-design/icons'
import { Button, Skeleton } from 'antd'
import { Link, useNavigate } from 'react-router-dom'
import { StudioDirectingService, type ChapterOverview, type ProjectRead } from '../../../../../services/generated'
import { useChapters } from '../hooks/useProjectData'
import { ProjectContentToolbar } from '../ProjectContentToolbar'
import { projectTabLocation } from '../constants'
import { apiErrorMessage } from '../../../../../services/apiErrorMessage'
import { chapterActionLocation, chapterLocation, workbenchManagementLocation } from '../../../directing/chapterNavigation'
import { readRecentWork } from '../../../directing/workspaceContext'
import { buildFileDownloadUrl } from '../../../assets/utils'
import { AssetEditPageBase } from '../../../assets/components/AssetEditPageBase'
import { assetAdapters } from '../../../assets/assetAdapters'
import { chapterProduction } from '../../chapterProduction'
import { OverviewResources } from './OverviewResources'
import type { ProjectResourceKind } from './ProjectResourcesTab'
import '../project-overview.css'
import '../project-asset-detail.css'

const overviewDestination = 'project-overview'

export function DashboardTab({ projectId, project, projectLoading, chapterData }: {
  projectId: string
  project: ProjectRead | null
  projectLoading: boolean
  chapterData: ReturnType<typeof useChapters>
}) {
  const uiText = useUiText()
  const navigate = useNavigate()
  const { chapters, loading, error: chapterError, refresh, total, totalKnown } = chapterData
  const [sceneResult, setSceneResult] = useState<{ chapter: (typeof chapters)[number]; overview?: ChapterOverview; error?: string }>()
  const [selectedId, setSelectedId] = useState('')
  const [retry, setRetry] = useState(0)
  const [resourceRefresh, setResourceRefresh] = useState(0)
  const [asset, setAsset] = useState<{ kind: ProjectResourceKind; id: string; trigger: HTMLElement; panel: HTMLElement | null; scrollTop: number }>()
  const recentChapterId = readRecentWork(projectId)?.chapterId
  const chapter = chapters.find(row => row.id === recentChapterId)
    ?? chapters.find(row => row.status !== 'done') ?? chapters[0]
  const previewChapters = chapter
    ? [chapter, ...chapters.filter(row => row.id !== chapter.id).sort((a, b) => a.index - b.index)].slice(0, 3)
    : []
  const selected = previewChapters.find(row => row.id === selectedId) ?? previewChapters[0]
  const production = selected && chapterProduction(selected)
  const currentResult = sceneResult?.chapter === selected ? sceneResult : undefined
  const scenesLoading = loading || (!chapterError && !!selected && !currentResult)
  const sequences = currentResult?.overview?.sequences ?? []

  useEffect(() => {
    if (loading || chapterError || !selected) return
    let active = true
    const chapterId = selected.id
    setSceneResult(undefined)
    void StudioDirectingService.directingChapterOverview({ projectId, chapterId }).then(({ data }) => {
      if (!data || data.chapter_id !== chapterId) throw new Error(uiText("场次列表读取失败，请重试"))
      if (active) setSceneResult({ chapter: selected, overview: data })
    }).catch(cause => {
      if (active) setSceneResult({ chapter: selected, error: apiErrorMessage(cause) })
    })
    return () => { active = false }
  }, [uiText, selected, projectId, retry, loading, chapterError])

  const cover = buildFileDownloadUrl(project?.cover_file_id)
  const projectMeta = [
    project?.style && uiText(project.style),
    project?.visual_style && uiText(project.visual_style),
    totalKnown && !loading && uiText("{{count}} 章", { count: total }),
  ].filter(Boolean).join(' · ')

  function openResource(kind: ProjectResourceKind, id: string, trigger: HTMLElement) {
    const panel = trigger.closest<HTMLElement>('.project-workbench-content')
    setAsset({ kind, id, trigger, panel, scrollTop: panel?.scrollTop ?? 0 })
    panel?.scrollTo(0, 0)
  }

  return <>
    {asset ? <div className="project-asset-detail-view">
      <AssetEditPageBase {...assetAdapters[asset.kind]} assetId={asset.id} backTo={overviewDestination}
        renderToolbar={children => <ProjectContentToolbar>{children}</ProjectContentToolbar>}
        onNavigate={destination => {
          if (destination && destination !== overviewDestination) return
          setAsset(undefined)
          setResourceRefresh(value => value + 1)
          requestAnimationFrame(() => {
            asset.panel?.scrollTo(0, asset.scrollTop)
            asset.trigger.focus({ preventScroll: true })
          })
        }} />
    </div> : <ProjectContentToolbar><h1 className="app-page-title">{uiText("项目概览")}</h1></ProjectContentToolbar>}
    <div className="project-overview" hidden={!!asset}>
      <section className="overview-project-header" aria-label={uiText("项目信息")}>
        <div className="overview-info-body" aria-busy={projectLoading}>
          {projectLoading ? <OverviewSkeleton /> : project && <>
            {cover && <img className="overview-project-cover" src={cover} alt="" onError={event => { event.currentTarget.hidden = true }} />}
            <div className="overview-project-copy">
              <h3 title={project.name}>{project.name}</h3>
              {projectMeta && <p className="overview-project-meta">{projectMeta}</p>}
              {project.description
                ? <p className="overview-description" title={project.description}>{project.description}</p>
                : <Link to={projectTabLocation(projectId, 'settings')}>{uiText("添加项目简介")}</Link>}
            </div>
          </>}
        </div>
        <Link className="overview-settings" to={projectTabLocation(projectId, 'settings')}>{uiText("项目设置")}</Link>
      </section>
      <Panel id="project-overview-sequences" title={uiText("章节制作")}
        action={<Link to={chapterLocation(projectId)}>{uiText("查看全部章节")} <ArrowRightOutlined aria-hidden /></Link>}>
        <div className="overview-scenes-body" aria-busy={scenesLoading}>
          {loading ? <div className="overview-scenes-layout"><OverviewSkeleton /><OverviewSkeleton /></div>
            : chapterError ? <OverviewMessage error action={<Button onClick={() => void refresh()}>{uiText("重试")}</Button>}>{chapterError}</OverviewMessage>
            : !selected || !production ? <OverviewMessage action={<Button type="primary" onClick={() => navigate(`${chapterLocation(projectId)}&create=1`)}>{uiText("创建第一章")}</Button>}>
              {uiText("创建第一章开始创作")}
            </OverviewMessage>
            : <div className="overview-scenes-layout">
              <div className="overview-chapter-options" role="group" aria-label={uiText("选择章节")}>
                {previewChapters.map(row => <button key={row.id} type="button" title={row.title}
                  aria-label={row.title}
                  aria-describedby={row.id === chapter?.id ? 'overview-current-chapter-marker' : undefined}
                  aria-pressed={selected.id === row.id} onClick={() => setSelectedId(row.id)}>
                  <span>{row.title}</span>{row.id === chapter?.id && <small id="overview-current-chapter-marker">{uiText("当前")}</small>}
                </button>)}
              </div>
              <div className="overview-scene-preview">
                <div className="overview-selected-chapter">
                  <div className="overview-current-heading">
                    <h3 title={selected.title}>{uiText("第 {{index}} 章 · {{title}}", { index: selected.index, title: selected.title })}</h3>
                    <p>
                      <span className="chapter-production-state" data-tone={production.tone}>{uiText(production.state)}</span>
                      <span>{selected.sequenceCount === undefined ? uiText("场次数量待核对") : uiText("{{sequenceCount}} 个场次", { sequenceCount: selected.sequenceCount })}</span>
                    </p>
                  </div>
                  <Button type="primary" onClick={() => navigate(chapterActionLocation(projectId, selected.id, production.target))}>
                    {uiText({ edit: '编辑原文', source: '划分场次', manage: '工作台管理' }[production.target])}
                  </Button>
                </div>
                {scenesLoading ? <OverviewSkeleton />
                  : currentResult?.error ? <OverviewMessage error action={<Button onClick={() => { setSceneResult(undefined); setRetry(value => value + 1) }}>{uiText("重试读取场次")}</Button>}>{currentResult.error}</OverviewMessage>
                  : !sequences.length ? <p className="overview-no-scenes">{uiText("暂无章节场次")}</p> : <>
                    <ul className="overview-scene-links">
                      {sequences.slice(0, 3).map(scene => <li key={scene.id}>
                        <Link to={workbenchManagementLocation(projectId, selected.id, scene.id)} aria-label={scene.title} aria-describedby={`overview-scene-${scene.id}`}>
                          <span className="overview-scene-copy" id={`overview-scene-${scene.id}`}>
                            <span className="overview-scene-title">
                              <strong title={scene.title}>{scene.title}</strong>
                              {scene.source_changed && <small>{uiText("原文已变更")}</small>}
                            </span>
                            {scene.source_excerpt && <small title={scene.source_excerpt}>{scene.source_excerpt}</small>}
                          </span>
                          <ArrowRightOutlined aria-hidden />
                        </Link>
                      </li>)}
                    </ul>
                    {sequences.length > 3 && <Link className="overview-all-scenes" to={workbenchManagementLocation(projectId, selected.id)}>
                      {uiText("查看本章全部场次")} <ArrowRightOutlined aria-hidden />
                    </Link>}
                </>}
              </div>
            </div>}
        </div>
      </Panel>
      <Panel id="project-overview-resources" title={uiText("项目资源")}>
        <OverviewResources projectId={projectId} refresh={resourceRefresh} onOpen={openResource} />
      </Panel>
    </div>
  </>
}

function Panel({ id, title, action, children }: {
  id: string; title: string; action?: ReactNode; children: ReactNode
}) {
  return <section className="overview-panel" aria-labelledby={id}>
    <header><h2 id={id}>{title}</h2>{action}</header>
    {children}
  </section>
}

function OverviewSkeleton() {
  return <div aria-hidden="true"><Skeleton active title={{ width: '45%' }} paragraph={{ rows: 2 }} /></div>
}

function OverviewMessage({ children, action, error }: { children: ReactNode; action?: ReactNode; error?: boolean }) {
  return <div className="overview-message" role={error ? "alert" : undefined}><span>{children}</span>{action}</div>
}
