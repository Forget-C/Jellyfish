import { useUiText } from '../../../../uiText'
import './assetGeneration.css'
import type { ReactNode } from 'react'
import { Alert, Button, Modal, Space } from 'antd'

/** 共用生成与参考选择弹窗，配置和任务状态由详情会话维护。 */
export function AssetGenerationDialog({ label, referencePurpose, referenceUploading, references, editing, open, generating, dirty, disabled, onCancel, onGenerate, error, children }: {
  referencePurpose?: 'subject' | 'costume' | 'prop'; referenceUploading?: boolean
  label: string; references: boolean; editing: boolean; open: boolean; generating: boolean; dirty: boolean; disabled: boolean
  error?: string; onCancel: () => void; onGenerate: () => void; children: ReactNode
}) {
  const uiText = useUiText()
  return <Modal title={references ? uiText("选择{{value1}}参考", { value1: uiText(referencePurpose === 'costume' ? '服装' : referencePurpose === 'prop' ? '道具' : '主体') }) : editing ? uiText("局部修改图片") : uiText("生成{{label}}图片", { label: uiText(label) })} className="asset-generation-dialog" width={840} centered open={open}
    onCancel={() => { if (!generating && !referenceUploading) onCancel() }} maskClosable={!generating && !referenceUploading} closable={!referenceUploading} keyboard={!referenceUploading}
    footer={references ? null : <><div aria-live="polite">{error && <Alert type="error" message={uiText("生成提交失败，请核对详情后重试")} />}</div><Space><Button aria-label={uiText("取消")} disabled={generating} onClick={onCancel}>{uiText("取消")}</Button>
      <Button aria-label={dirty ? uiText("保存并生成") : uiText("生成")} type="primary" loading={generating} disabled={disabled} onClick={onGenerate}>{dirty ? uiText("保存并生成") : uiText("生成")}</Button></Space></>}>
    {children}
  </Modal>
}
