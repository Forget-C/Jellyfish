import { lazy, Suspense } from 'react'
import { useSearchParams, useParams } from 'react-router-dom'
import { GenerationCanvasPage } from './GenerationCanvasPage'

const MovementPrototype = import.meta.env.DEV ? lazy(() => import('./MovementLayout.prototype')) : undefined

export function GenerationCanvasRoute() {
  const { projectId } = useParams()
  const [search] = useSearchParams()
  if (MovementPrototype && search.get('prototype') === 'movement') return <Suspense fallback={null}><MovementPrototype /></Suspense>
  return projectId ? <GenerationCanvasPage projectId={projectId} /> : null
}
