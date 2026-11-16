import './assetGeneration.css'
import type { ReactNode } from 'react'
import { Alert, Button, Modal, Space } from 'antd'

/** 共用生成与参考选择弹窗，配置和任务状态由详情会话维护。 */
export function AssetGenerationDialog({ label, references, editing, open, generating, dirty, disabled, onCancel, onGenerate, error, children }: {
  label: string; references: boolean; editing: boolean; open: boolean; generating: boolean; dirty: boolean; disabled: boolean
  error?: string; onCancel: () => void; onGenerate: () => void; children: ReactNode
}) {
  return <Modal title={references ? '选择参考主体' : editing ? '局部修改图片' : `生成${label}图片`} className="asset-generation-dialog" width={840} centered open={open}
    onCancel={() => { if (!generating) onCancel() }} maskClosable={!generating}
    footer={references ? null : <><div aria-live="polite">{error && <Alert type="error" message="生成提交失败，请核对详情后重试" />}</div><Space><Button aria-label="取消" disabled={generating} onClick={onCancel}>取消</Button>
      <Button aria-label={dirty ? '保存并生成' : '生成'} type="primary" loading={generating} disabled={disabled} onClick={onGenerate}>{dirty ? '保存并生成' : '生成'}</Button></Space></>}>
    {children}
  </Modal>
}
