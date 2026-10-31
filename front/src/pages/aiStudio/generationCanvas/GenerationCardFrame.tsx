import type { ReactNode } from 'react'
import './generationCardFrame.css'

/** 模型与参考卡共用几何；32 标题＋185 预览＋32 状态＋2 边框，不迁移坐标。 */
export const GENERATION_CARD_SIZE = { width: 300, height: 251 }

/** 内容限制在预览区，状态始终固定在卡片底部。画布操作由 CardShell 管理。 */
export function GenerationCardFrame({ children, status, label }: { children: ReactNode; status: ReactNode; label: string }) {
  return <div className="generation-output-card">
    <section className="generation-output-preview" aria-label={label}>{children}</section>
    <footer className="generation-card-footer">{status}</footer>
  </div>
}
