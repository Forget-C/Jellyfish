import { useUiText } from '../../../uiText'
import { useState } from 'react'
import { Alert, Select } from 'antd'
import { PictureOutlined } from '@ant-design/icons'
import type { CanvasDocument, ImageContentCard, NamedImageReferenceCard } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'
import { WorkbenchButton as Button, WorkbenchIconButton } from '../../../components/workbench/WorkbenchButton'
import { WorkbenchDialogActions, WorkbenchModal } from '../../../components/workbench/WorkbenchModal'
import { storyboardImageCards, storyboardReferenceCard } from './storyboardReferenceEdits'

/** 显式分镜画布的对象参考设置，选图只使用当前画布的真实内容卡。 */
export function StoryboardReferences({ document, readonly, setDefault, setOverride }: {
  document: CanvasDocument
  readonly: boolean
  setDefault: (reference: NamedImageReferenceCard, image?: ImageContentCard) => string | undefined
  setOverride: (shotId: string, objectId: string, image?: ImageContentCard) => string | undefined
}) {
  const uiText = useUiText()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string>()
  if (!document.storyboard) return null
  const images = storyboardImageCards(document)
  const options = images.map((image, index) => ({ value: image.id,
    label: <span className="generation-reference-option"><img alt="" src={buildFileDownloadUrl(image.file_id!)} />
      <span>{uiText("图片内容卡")} {index + 1}</span></span>,
  }))
  const picker = (label: string, reference: NamedImageReferenceCard | undefined, choose: (image: ImageContentCard) => string | undefined) =>
    <Select aria-label={label} placeholder={label} value={reference?.image_binding?.source?.card_id ?? undefined}
      disabled={readonly || !images.length} options={options} style={{ width: '100%' }}
      onSelect={id => {
        const image = images.find(card => card.id === id)
        if (image) setError(choose(image))
      }} />
  return <>
    <WorkbenchIconButton label={uiText("对象参考")} icon={<PictureOutlined />} variant="quiet" onClick={() => { setError(undefined); setOpen(true) }} />
    <WorkbenchModal title={uiText("对象参考")} open={open} onCancel={() => setOpen(false)} width={680}
      footer={<WorkbenchDialogActions secondary={null}><Button variant="primary" onClick={() => setOpen(false)}>{uiText("完成")}</Button></WorkbenchDialogActions>}>
      {error && <Alert type="warning" showIcon message={error} />}
      <p>{uiText("镜头默认沿用当前画布的对象参考，也可单独指定。已手工修改的模型采用保持原样。")}</p>
      {!images.length && <p>{uiText("添加有文件的图片内容卡后即可选择参考图。")}</p>}
      {document.storyboard.objects.map(object => {
        const reference = storyboardReferenceCard(document, object.reference_card_id)
        const description = document.cards?.find(card => card.id === object.description_card_id)
        const name = (description && 'name' in description ? description.name : reference?.name) || '对象'
        return <section key={object.object_id} aria-label={uiText("{{name}}默认参考", { name })} className="generation-storyboard-reference">
          <h3>{name}</h3>
          <div className="generation-storyboard-reference-row">
            <span>{uiText("画布默认")}</span>
            {reference ? picker('选择默认参考图', reference, image => setDefault(reference, image)) : <small>{uiText("默认参考卡已移除")}</small>}
            {reference?.image_binding && <Button variant="quiet" disabled={readonly}
              onClick={() => setError(setDefault(reference))}>{uiText("清除默认")}</Button>}
          </div>
          {document.storyboard!.shots.filter(shot => shot.object_ids.includes(object.object_id)).map(shot => {
            const shotCard = document.cards?.find(card => card.id === shot.card_id)
            if (!shotCard) return null
            const label = ('name' in shotCard && shotCard.name) || uiText("镜头")
            const override = storyboardReferenceCard(document, shot.reference_overrides?.[object.object_id])
            return <section key={shot.shot_id} className="generation-storyboard-reference-row" aria-label={`${label}：${name}`}>
              <div><span>{label}</span><small>{override ? uiText("镜头指定") : uiText("继承默认")}</small></div>
              {reference && picker('指定镜头参考图', override, image => setOverride(shot.shot_id, object.object_id, image))}
              {override && <Button variant="quiet" disabled={readonly} onClick={() => setError(setOverride(shot.shot_id, object.object_id))}>{uiText("恢复继承")}</Button>}
            </section>
          })}
        </section>
      })}
    </WorkbenchModal>
  </>
}
