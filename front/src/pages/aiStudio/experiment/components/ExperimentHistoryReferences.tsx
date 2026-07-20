/** 实验室历史中已提交参考图片的紧凑展示。 */
import type { FileRead } from '../../../../services/generated'
import { buildFileDownloadUrl } from '../../assets/utils'

type ExperimentHistoryReference = {
  id: string
  label: string
}

type ExperimentHistoryReferencesProps = {
  files: FileRead[]
  references: ExperimentHistoryReference[]
}

/**
 * 展示历史消息中不可编辑的参考图快照。
 *
 * 文件清理或权限变化后，仍保留槽位和“文件不可用”提示，避免历史记录看似缺失。
 */
export function ExperimentHistoryReferences({ files, references }: ExperimentHistoryReferencesProps) {
  if (!references.length) return null
  return <div className="mt-3 flex flex-wrap gap-2">
    {references.map((reference) => {
      const file = files.find((item) => item.id === reference.id)
      return <div key={`${reference.label}-${reference.id}`} className="w-16" title={file?.name ?? `${reference.label}（文件不可用）`}>
        {file ? <img src={buildFileDownloadUrl(file.id)} alt={`${reference.label}：${file.name}`} className="h-12 w-16 rounded border border-slate-200 object-cover" /> : <div className="flex h-12 w-16 items-center justify-center rounded border border-dashed border-slate-300 bg-slate-100 px-1 text-center text-[10px] text-slate-400">文件不可用</div>}
        <div className="mt-1 truncate text-center text-[10px] text-slate-500">{reference.label}</div>
      </div>
    })}
  </div>
}
