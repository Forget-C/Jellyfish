/** Shared full-height layout for text, image, and future experiment laboratories. */
import type { ReactNode } from 'react'
import { Card } from 'antd'
import { WorkspaceLayout } from '../../../../components'

type ExperimentLabLayoutProps = {
  title: string
  extra?: ReactNode
  sidebar?: ReactNode
  history: ReactNode
  composer: ReactNode
  overlays?: ReactNode
}

/** Aligns laboratory history and input areas while callers provide modality-specific content. */
export function ExperimentLabLayout({ title, extra, sidebar, history, composer, overlays }: ExperimentLabLayoutProps) {
  return (
    <WorkspaceLayout>
      <Card title={title} className="app-fill-card" extra={extra}>
        <div className="flex min-h-0 flex-1 gap-4">
          {sidebar}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex-1 min-h-0 space-y-4 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 pr-3 shadow-inner">
              {history}
            </div>
            {composer}
          </div>
        </div>
      </Card>
      {overlays}
    </WorkspaceLayout>
  )
}
