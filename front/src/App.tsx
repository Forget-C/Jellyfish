import type React from 'react'
import { lazy, Suspense } from 'react'
import { Alert } from 'antd'
import { createBrowserRouter, createRoutesFromElements, RouterProvider, Navigate, Route, useLocation, useParams } from 'react-router-dom'
import MainLayout from './layouts/MainLayout'
import ManagementLayout from './layouts/ManagementLayout'
import HomePage from './pages/home/HomePage'
import Settings from './pages/Settings'
import NotFound from './pages/NotFound'
import ProjectLobby from './pages/aiStudio/project/ProjectLobby'
import ProjectWorkbench from './pages/aiStudio/project/ProjectWorkbench'
import RoleDetailPage from './pages/aiStudio/project/ProjectWorkbench/RoleDetailPage'
import AssetManager from './pages/aiStudio/assets/AssetManager'
import ActorAssetEditPage from './pages/aiStudio/assets/ActorAssetEditPage.tsx'
import SceneAssetEditPage from './pages/aiStudio/assets/SceneAssetEditPage.tsx'
import PropAssetEditPage from './pages/aiStudio/assets/PropAssetEditPage.tsx'
import CostumeAssetEditPage from './pages/aiStudio/assets/CostumeAssetEditPage.tsx'
import PromptTemplateManager from './pages/aiStudio/prompts/PromptTemplateManager'
import FileManager from './pages/aiStudio/files/FileManager'
import AgentManagement from './pages/aiStudio/agents/AgentManagement'
import AgentEdit from './pages/aiStudio/agents/AgentEdit.tsx'
import ModelManagement from './pages/aiStudio/models/ModelManagement'
import ExperimentLabPage from './pages/aiStudio/experiment/ExperimentLabPage'
import ChapterSequencesPage from './pages/aiStudio/directing/ChapterSequencesPage'
import { WorkbenchManagementPage } from './pages/aiStudio/directing/WorkbenchManagementPage'
import { chapterCompositionRetired, legacyChapterManagementLocation } from './pages/aiStudio/directing/chapterNavigation'
import { SceneCanvasWorkbench } from './pages/aiStudio/directing/SceneCanvasWorkbench'
import { CanvasListPage } from './pages/aiStudio/generationCanvas/CanvasListPage'
import { GenerationCanvasPage } from './pages/aiStudio/generationCanvas/GenerationCanvasPage'
import './App.css'

/** 章节抽屉链接在初始化项目页之前重定向。 */
function ProjectEntry() {
  const location = useLocation()
  const { projectId } = useParams()
  const params = new URLSearchParams(location.search)
  const chapterId = params.get('chapter')
  const assembly = params.get('panel') === 'assembly'
  if (projectId && chapterId && (assembly || !params.has('edit') && (!params.has('tab') || params.get('tab') === 'chapters'))) {
    return <Navigate replace to={legacyChapterManagementLocation(projectId, chapterId, params)}
      state={assembly ? chapterCompositionRetired : undefined} />
  }
  if (projectId && assembly) return <Alert type="error" showIcon message="章节组合已停用，旧链接缺少章节标识。" />
  return <ProjectWorkbench key={projectId} />
}

const WorkbenchExamples = import.meta.env.DEV ? lazy(() => import('./pages/aiStudio/directing/ui/WorkbenchExamples')) : undefined

const router = createBrowserRouter(createRoutesFromElements(
      <>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<HomePage />} />
          <Route path="projects" element={<ProjectLobby />} />
          <Route path="projects/:projectId" id="project-navigation">
            <Route index element={<ProjectEntry />} />
            <Route path="roles/:characterId/edit" element={<RoleDetailPage />} />
            <Route path="chapters/:chapterId/sequences" element={<ChapterSequencesPage />} />
          </Route>
          <Route path="canvases" element={<CanvasListPage />} />
          <Route path="canvases/:canvasId" element={<GenerationCanvasPage />} />
          <Route path="projects/:projectId/chapters/:chapterId/workbench-management" element={<WorkbenchManagementPage />} />
          <Route path="projects/:projectId/chapters/:chapterId/sequences/:sequenceId/canvas-workbench" element={<SceneCanvasWorkbench />} />
          <Route element={<ManagementLayout />}>
            <Route path="assets" element={<AssetManager />} />
            <Route path="assets/actors/:actorImageId/edit" element={<ActorAssetEditPage />} />
            <Route path="assets/scenes/:sceneId/edit" element={<SceneAssetEditPage />} />
            <Route path="assets/props/:propId/edit" element={<PropAssetEditPage />} />
            <Route path="assets/costumes/:costumeId/edit" element={<CostumeAssetEditPage />} />
            <Route path="prompts" element={<PromptTemplateManager />} />
            <Route path="files" element={<FileManager />} />
            <Route path="agents/:id/edit" element={<AgentEdit />} />
            <Route path="agents" element={<AgentManagement />} />
            <Route path="models" element={<ModelManagement />} />
          </Route>
          <Route path="lab" element={<ExperimentLabPage />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
          {WorkbenchExamples && <Route path="/dev/workbench-ui" element={<Suspense fallback={<p>加载组件示例…</p>}><WorkbenchExamples /></Suspense>} />}
      </>
))

const App: React.FC = () => <RouterProvider router={router} />

export default App
