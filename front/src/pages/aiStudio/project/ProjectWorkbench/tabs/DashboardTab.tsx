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
  const [sceneResult, setSceneResult] = useState<{ chapters: typeof chapters; rows: ChapterOverview[]; error?: string }>()
  const [selectedId, setSelectedId] = useState('')
  const [retry, setRetry] = useState(0)
  const [resourceRefresh, setResourceRefresh] = useState(0)
  const [asset, setAsset] = useState<{ kind: ProjectResourceKind; id: string; trigger: HTMLElement; panel: HTMLElement | null; scrollTop: number }>()
  useEffect(() => {
    if (loading || chapterError || !chapters.length) return
    let active = true
    void Promise.all([...chapters].sort((a, b) => a.index - b.index).map(async chapter => {
      const result = await StudioDirectingService.directingChapterOverview({ projectId, chapterId: chapter.id })
      if (!result.data || result.data.chapter_id !== chapter.id) throw new Error(uiText("场次列表读取失败，请重试"))
      return result.data
    })).then(rows => {
      if (active) setSceneResult({ chapters, rows })
    }).catch(cause => {
      if (active) setSceneResult({ chapters, rows: [], error: apiErrorMessage(cause) })
    })
    return () => { active = false }
  }, [uiText, chapters, projectId, retry, loading, chapterError])

  const recentChapterId = readRecentWork(projectId)?.chapterId
  const chapter = chapters.find(row => row.id === recentChapterId)
    ?? chapters.find(row => row.status !== 'done') ?? chapters[0]
  const production = chapter && chapterProduction(chapter)
  const currentResults = sceneResult?.chapters === chapters ? sceneResult : undefined
  const scenesLoading = loading || (!chapterError && chapters.length > 0 && !currentResults)
  const ordered = (currentResults?.rows ?? []).filter(row => row.sequences.length > 0)
  const previewRows = [
    ...ordered.filter(row => row.chapter_id === chapter?.id),
    ...ordered.filter(row => row.chapter_id !== chapter?.id),
  ].slice(0, 3)
  const selected = previewRows.find(row => row.chapter_id === selectedId) ?? previewRows[0]
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
      <Panel id="project-current-production" title={uiText("当前制作")}>
        <div className="overview-current-body" aria-busy={loading}>
          {loading ? <OverviewSkeleton /> : chapterError
            ? <OverviewMessage error action={<Button onClick={() => void refresh()}>{uiText("重试")}</Button>}>{chapterError}</OverviewMessage>
            : chapter && production ? <>
              <div className="overview-current-heading">
                <h3 title={chapter.title}>{uiText("第 {{index}} 章 · {{title}}", { index: chapter.index, title: chapter.title })}</h3>
                <span className="chapter-production-state" data-tone={production.tone}>{uiText(production.state)}</span>
              </div>
              <p>{chapter.sequenceCount === undefined ? uiText("场次数量待核对") : uiText("{{sequenceCount}} 个场次", { sequenceCount: chapter.sequenceCount })}</p>
              {chapter.summary && <p className="overview-description">{chapter.summary}</p>}
              <Button type="primary" onClick={() => navigate(chapterActionLocation(projectId, chapter.id, production.target))}>
                {uiText({ edit: '编辑原文', source: '划分场次', manage: '工作台管理' }[production.target])}
              </Button>
            </> : <OverviewMessage action={<Button type="primary" onClick={() => navigate(`${chapterLocation(projectId)}&create=1`)}>{uiText("创建第一章")}</Button>}>
              {uiText("创建第一章开始创作")}
            </OverviewMessage>}
        </div>
      </Panel>
      <Panel id="project-overview-info" title={uiText("项目信息")}
        action={<Link to={projectTabLocation(projectId, 'settings')}>{uiText("项目设置")}</Link>}>
        <div className="overview-info-body" aria-busy={projectLoading}>
          {projectLoading ? <OverviewSkeleton /> : project && <>
            {cover && <img className="overview-project-cover" src={cover} alt="" onError={event => { event.currentTarget.hidden = true }} />}
            <div className="overview-project-copy">
              <h3 title={project.name}>{project.name}</h3>
              {projectMeta && <p className="overview-project-meta">{projectMeta}</p>}
              <p className="overview-description">{project.description || uiText("尚未填写项目简介")}</p>
            </div>
          </>}
        </div>
      </Panel>
      <Panel id="project-overview-resources" title={uiText("项目资源")} wide>
        <OverviewResources projectId={projectId} refresh={resourceRefresh} onOpen={openResource} />
      </Panel>
      <Panel id="project-overview-sequences" title={uiText("章节场次")} wide
        action={<Link to={chapterLocation(projectId)}>{uiText("查看全部章节")} <ArrowRightOutlined aria-hidden /></Link>}>
        <div className="overview-scenes-body" aria-busy={scenesLoading}>
          {scenesLoading ? <div className="overview-scenes-layout"><OverviewSkeleton /><OverviewSkeleton /></div>
            : chapterError ? <OverviewMessage error action={<Button onClick={() => void refresh()}>{uiText("重试读取章节")}</Button>}>{uiText("章节读取失败，暂无法展示场次")}</OverviewMessage>
            : currentResults?.error ? <OverviewMessage error action={<Button onClick={() => { setSceneResult(undefined); setRetry(value => value + 1) }}>{uiText("重试读取场次")}</Button>}>{currentResults.error}</OverviewMessage>
            : !selected ? <OverviewMessage>{chapters.length ? uiText("划分场次后，可在这里继续制作") : uiText("暂无章节场次")}</OverviewMessage>
            : <div className="overview-scenes-layout">
              <div className="overview-chapter-options" role="group" aria-label={uiText("选择章节")}>
                {previewRows.map(row => <button key={row.chapter_id} type="button" title={row.title}
                  aria-pressed={selected.chapter_id === row.chapter_id} onClick={() => setSelectedId(row.chapter_id)}>{row.title}</button>)}
              </div>
              <div className="overview-scene-preview">
                <ul className="overview-scene-links">
                  {selected.sequences.slice(0, 3).map(scene => <li key={scene.id}>
                    <Link to={workbenchManagementLocation(projectId, selected.chapter_id, scene.id)} aria-label={scene.title} aria-describedby={`overview-scene-${scene.id}`}>
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
                {selected.sequences.length > 3 && <Link className="overview-all-scenes" to={workbenchManagementLocation(projectId, selected.chapter_id)}>
                  {uiText("查看本章全部场次")} <ArrowRightOutlined aria-hidden />
                </Link>}
              </div>
            </div>}
        </div>
      </Panel>
    </div>
  </>
}

function Panel({ id, title, wide, action, children }: {
  id: string; title: string; wide?: boolean; action?: ReactNode; children: ReactNode
}) {
  return <section className="overview-panel" data-wide={wide || undefined} aria-labelledby={id}>
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
