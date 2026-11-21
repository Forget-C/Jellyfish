import { useUiText } from '../../uiText'
import { Button, Pagination, Space } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import './card-list-layout.css'

/** Reserves the footer height even when all results fit on one page. */
export function CardListPagination({ label, page, pageSize, total, compact, disabled, onChange }: {
  label: string
  page: number
  pageSize: number
  total: number
  compact: boolean
  disabled: boolean
  onChange: (page: number) => void
}) {
  const uiText = useUiText()
  const lastPage = Math.ceil(total / pageSize)
  return <div className="app-card-list-pagination">
    {pageSize > 0 && lastPage > 1 && <nav aria-label={label}>
      {compact ? <Space>
        <Button aria-label={uiText("上一页")} icon={<LeftOutlined />} disabled={disabled || page <= 1} onClick={() => onChange(page - 1)} />
        <span>{page} / {lastPage}</span>
        <Button aria-label={uiText("下一页")} icon={<RightOutlined />} disabled={disabled || page >= lastPage} onClick={() => onChange(page + 1)} />
      </Space> : <Pagination current={page} pageSize={pageSize} total={total} size="small"
        showSizeChanger={false} disabled={disabled} onChange={onChange} />}
    </nav>}
  </div>
}
