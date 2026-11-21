import { currentLanguage } from '../../../../i18n'
import { useUiText } from '../../../../uiText'
import { Tag } from 'antd'
import './project-resource-card.css'

/** 资产库和项目卡片共用来源及创建日期；旧时间字段按 UTC 解析，显示本地日期。 */
export function ResourceCardMetadata({ asset }: { asset?: { origin?: string | null; source_character_id?: string | null; created_at?: string | null } }) {
  const uiText = useUiText()
  const sourceLabel = !asset ? uiText("来源未提供") : asset.source_character_id ? uiText("从角色转化") : ({ upload: '上传', project: '项目转化', library: '资产库导入', created: '设定创建' } as Record<string, string>)[asset.origin ?? 'created'] ?? uiText("来源未提供")
  const createdAt = asset?.created_at ? new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(asset.created_at) ? asset.created_at : asset.created_at + 'Z') : undefined
  const validDate = createdAt && !Number.isNaN(createdAt.getTime())
  const createdDate = validDate ? createdAt.toLocaleDateString(currentLanguage(), { year: 'numeric', month: '2-digit', day: '2-digit' }) : uiText("日期未提供")
  return <div className="resource-card-metadata"><Tag>{uiText(sourceLabel)}</Tag>{validDate ? <time dateTime={createdAt.toISOString()} aria-label={uiText("创建日期 {{createdDate}}", { createdDate })} title={uiText("创建时间：{{value1}}", { value1: createdAt.toLocaleString(currentLanguage()) })}>{createdDate}</time> : <span>{createdDate}</span>}</div>
}
