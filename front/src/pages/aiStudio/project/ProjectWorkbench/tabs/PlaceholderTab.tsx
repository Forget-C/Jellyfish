import { Card, Empty, Button } from 'antd'
import { ScrollablePage } from '../../../components/ScrollablePage'

export function PlaceholderTab({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string
  description: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <ScrollablePage className="pr-1">
      <Card>
        <Empty
          description={
            <div className="text-left">
              <div className="font-medium text-gray-900 mb-1">{title}</div>
              <p className="text-gray-500 text-sm mb-3">{description}</p>
              <Button type="primary" onClick={onAction}>
                {actionLabel}
              </Button>
            </div>
          }
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </Card>
    </ScrollablePage>
  )
}
