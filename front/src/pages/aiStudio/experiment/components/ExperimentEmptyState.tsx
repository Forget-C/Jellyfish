/** Shared empty-history presentation for every experiment laboratory. */
import { Empty } from 'antd'

type ExperimentEmptyStateProps = {
  description: string
}

/** Keeps the empty-history icon, typography, and centered spacing identical across experiment modalities. */
export function ExperimentEmptyState({ description }: ExperimentEmptyStateProps) {
  return (
    <div className="flex h-full min-h-56 items-center justify-center">
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={<span className="text-sm text-slate-500">{description}</span>}
      />
    </div>
  )
}
