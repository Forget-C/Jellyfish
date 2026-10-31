import type { ReactNode } from 'react'
import './generationCardFrame.css'

/** 参考卡与模型卡的默认几何；描述卡保留自身尺寸，不迁移坐标。 */
export const GENERATION_CARD_SIZE = { width: 300, height: 251 }
export const MODEL_CARD_SIZE = { width: 360, height: 424 }

/** 三类模型统一为正方形预览，参考卡沿用紧凑几何。 */
export function generationCardSize(type?: string) {
  return type?.startsWith('model.') ? MODEL_CARD_SIZE : GENERATION_CARD_SIZE
}

/** 内容限制在预览区，状态始终固定在卡片底部。画布操作由 CardShell 管理。 */
export function GenerationCardFrame({ children, status, label, height }: { children: ReactNode; status: ReactNode; label: string; height?: number }) {
  return <div className="generation-output-card" style={height === undefined ? undefined : { height }}>
    <section className="generation-output-preview" aria-label={label}>{children}</section>
    <footer className="generation-card-footer">{status}</footer>
  </div>
}
