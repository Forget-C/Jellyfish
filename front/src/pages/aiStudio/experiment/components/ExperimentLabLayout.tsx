/** Shared full-height layout for text, image, and future experiment laboratories. */
import type { ReactNode } from 'react'
import { Card } from 'antd'
import { WorkspaceLayout } from '../../../../components'

type ExperimentLabLayoutProps = {
  title: string
  extra?: ReactNode
  history: ReactNode
  composer: ReactNode
  overlays?: ReactNode
}

/** Aligns laboratory history and input areas while callers provide modality-specific content. */
export function ExperimentLabLayout({ title, extra, history, composer, overlays }: ExperimentLabLayoutProps) {
  return (
    <WorkspaceLayout>
      <Card title={title} className="app-fill-card" extra={extra}>
        <div className="flex flex-1 min-h-0 flex-col">
          <div className="flex-1 min-h-0 space-y-4 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 pr-3 shadow-inner">
            {history}
          </div>
          {composer}
        </div>
      </Card>
      {overlays}
    </WorkspaceLayout>
  )
}
