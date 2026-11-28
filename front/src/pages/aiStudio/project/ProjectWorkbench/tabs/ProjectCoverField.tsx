import { useUiText } from '../../../../../uiText'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Dropdown, Modal, Space } from 'antd'
import { DownOutlined } from '@ant-design/icons'
import { FileLibraryImagePicker } from '../../../assets/components/FileLibraryImagePicker'
import { buildFileDownloadUrl } from '../../../assets/utils'
import { ProjectCover } from '../../ProjectCover'

export type CoverDraft = File | string | null | undefined

/** 展示封面草稿，上传与采用均由设置表单保存。 */
export function ProjectCoverField({ projectId, savedId, draft, disabled, onChange }: {
  projectId: string
  savedId?: string | null
  draft: CoverDraft
  disabled: boolean
  onChange: (draft: CoverDraft) => void
}) {
  const uiText = useUiText()
  const upload = useRef<HTMLInputElement>(null)
  const [library, setLibrary] = useState(false)
  const [preview, setPreview] = useState<string>()
  const [error, setError] = useState('')
  const localFile = draft instanceof File ? draft : undefined
  const fileId = draft === undefined ? savedId : typeof draft === 'string' ? draft : undefined
  const hasCover = Boolean(fileId || localFile)

  useEffect(() => {
    if (!localFile) return
    const url = URL.createObjectURL(localFile)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [localFile])

  useEffect(() => { setError('') }, [draft])

  return <div className="project-settings-cover">
    <h3>{uiText("项目封面")}</h3>
    <ProjectCover projectId={projectId} source={localFile ? preview : buildFileDownloadUrl(fileId)}
      alt={hasCover ? uiText("项目封面预览") : undefined} />
    <Space wrap size={4}>
      <Dropdown trigger={['click']} disabled={disabled} menu={{
        items: [{ key: 'upload', label: uiText("上传图片") }, { key: 'library', label: uiText("从文件管理选择") }],
        onClick: ({ key }) => {
          if (key === 'upload') upload.current?.click()
          else setLibrary(true)
        },
      }}>
        <Button disabled={disabled}>{hasCover ? uiText("更换封面") : uiText("设置封面")} <DownOutlined aria-hidden /></Button>
      </Dropdown>
      {hasCover && <Button type="link" disabled={disabled} onClick={() => onChange(savedId ? null : undefined)}>{uiText("恢复默认封面")}</Button>}
    </Space>
    {error && <Alert type="error" message={error} />}
    <input ref={upload} type="file" hidden disabled={disabled} aria-label={uiText("上传项目封面")} accept=".jpg,.jpeg,.png,.webp,.gif"
      onChange={event => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        if (file.size > 20 * 1024 * 1024) { setError(uiText("封面图片不能超过 20 MB")); return }
        if (!/\.(jpe?g|png|webp|gif)$/i.test(file.name)) { setError(uiText("请选择 JPG、PNG、WebP 或 GIF 图片")); return }
        setError('')
        onChange(file)
      }} />
    <Modal open={library} title={uiText("从文件管理选择图片")} onCancel={() => setLibrary(false)} footer={null} destroyOnHidden>
      {library && <FileLibraryImagePicker onSelect={id => { onChange(id); setLibrary(false) }} disabled={disabled} />}
    </Modal>
  </div>
}
