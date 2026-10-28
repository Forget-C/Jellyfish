import { useParams } from 'react-router-dom'
import { GenerationCanvasPage } from './GenerationCanvasPage'

export function GenerationCanvasRoute() {
  const { projectId } = useParams()
  return projectId ? <GenerationCanvasPage projectId={projectId} /> : null
}
