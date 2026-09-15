export const workspaceStages = [
  { key: 'design', title: '导演设计', output: '得到拍摄方案' },
  { key: 'shoot', title: '单元试拍', output: '得到待挑选的视频' },
  { key: 'cut', title: '剪辑验收', output: '得到本场粗剪' },
] as const

export type WorkspaceStage = typeof workspaceStages[number]['key']
export const workspaceViews: Record<string, { stage: WorkspaceStage; title: string }> = {
  design: { stage: 'design', title: '拍摄方案' },
  shoot: { stage: 'shoot', title: '单元与生成指令' },
  visual: { stage: 'shoot', title: '验证参考画面' },
  batch: { stage: 'shoot', title: '批量生成' },
  cut: { stage: 'cut', title: '选片与粗剪' },
  continuity: { stage: 'cut', title: '检查实际连续性' },
  feedback: { stage: 'cut', title: '验收与局部返工' },
  ledger: { stage: 'cut', title: '来源与记录' },
}

/** 旧业务回跳保留原 view；未知入口安全落到设计，不猜测固定输入。 */
export function workspaceView(value: string | null): string {
  return value && Object.prototype.hasOwnProperty.call(workspaceViews, value) ? value : 'design'
}

/** 只更换视图，保留业务回跳携带的对象、版本和返回位置。 */
export function withWorkspaceView(search: URLSearchParams, view: string): URLSearchParams {
  const next = new URLSearchParams(search)
  next.set('view', workspaceView(view))
  return next
}
