import { useState } from 'react'
import { Checkbox, Radio } from 'antd'
import { StudioFilesService } from '../../../services/generated'
import { zip } from 'fflate'
import { WorkbenchModal, WorkbenchDialogActions } from '../../../components/workbench/WorkbenchModal'
import { WorkbenchButton as Button } from '../../../components/workbench/WorkbenchButton'
import { buildFileDownloadUrl } from '../assets/utils'
export type DownloadOutput = { key: string; name: string; fileId?: string; text?: string; modality: string; stale?: boolean }
function saveBlob(blob: Blob, name: string) {
  const url=URL.createObjectURL(blob), link=window.document.createElement('a')
  link.href=url;link.download=name;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),60000)
}
/** 二进制下载复用文件端点；失败不下载残缺压缩包，调用方保留选择以便重试。 */
export async function downloadOutputs(outputs: DownloadOutput[]) {
  const files: Record<string, Uint8Array>={}
  for (const [index, output] of outputs.entries()) {
    let blob: Blob
    if(output.fileId)blob=await StudioFilesService.downloadFileApiApiV1StudioFilesFileIdDownloadGet({fileId:output.fileId})
    else blob=new Blob([output.text || ''],{type:'text/plain;charset=utf-8'})
    const extension=output.modality==='text'?'txt':blob.type.split('/')[1]?.split(';')[0] || output.modality
    const name=`${index+1}-${output.name.replace(/[\\/:*?"<>|]/g,'_').slice(0,80)}.${extension}`
    if(outputs.length===1){saveBlob(blob,name);return}
    files[name]=new Uint8Array(await blob.arrayBuffer())
  }
  const data=await new Promise<Uint8Array>((resolve,reject)=>zip(files,{level:0},(error,result)=>error?reject(error):resolve(result)))
  saveBlob(new Blob([data as BlobPart],{type:'application/zip'}),'画布输出.zip')
}
/** 打开时固定结果集合；后台发布不会替换用户的选择。 */
export function CanvasOutputActions({mode,outputs,onCover,onClose}:{mode:'cover'|'download';outputs:DownloadOutput[];onCover:(fileId:string)=>void;onClose:()=>void}) {
  const [selected,setSelected]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const Selection = mode === 'cover' ? Radio : Checkbox
  const apply=async()=>{setBusy(true);setError('');try{const chosen=outputs.filter(output=>selected.includes(output.key));if(mode==='cover')onCover(chosen[0].fileId!);else await downloadOutputs(chosen);onClose()}catch{setError('下载失败，选择已保留，请重试')}finally{setBusy(false)}}
  return <WorkbenchModal title={mode==='cover'?'选择画布封面':'选择下载内容'} open onCancel={()=>{if(!busy)onClose()}} footer={<WorkbenchDialogActions secondary={<Button disabled={busy} onClick={onClose}>取消</Button>}><Button disabled={!selected.length} loading={busy} onClick={()=>void apply()}>{mode==='cover'?'设置为封面':`下载所选 ${selected.length} 项`}</Button></WorkbenchDialogActions>}>
    {mode==='download'&&<Checkbox checked={selected.length===outputs.length} indeterminate={!!selected.length&&selected.length<outputs.length} disabled={busy} onChange={event=>setSelected(event.target.checked?outputs.map(output=>output.key):[])}>全选</Checkbox>}
    {outputs.map((output,index)=><Selection key={output.key} className="generation-output-choice" name="canvas-output-choice" disabled={busy} checked={selected.includes(output.key)} onChange={event=>setSelected(mode==='cover'?[output.key]:event.target.checked?[...selected,output.key]:selected.filter(key=>key!==output.key))}><span className="generation-output-choice-content">{output.modality==='image'&&<img alt={`输出 ${index+1}`} src={buildFileDownloadUrl(output.fileId)}/>}<span>{output.name} · 输出 {index+1} · {output.modality}{output.stale?' · 旧正式成果':''}</span></span></Selection>)}
    {error&&<p role="alert">{error}</p>}
  </WorkbenchModal>
}
