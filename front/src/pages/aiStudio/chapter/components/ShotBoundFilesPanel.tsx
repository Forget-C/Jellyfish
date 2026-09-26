/**
 * 镜头「实际使用的文件」面板（第 5 步 关联绑定）。
 *
 * 为什么需要它（用户要求）：绑定环节不能只显示"关联了哪些资产名称"——真正决定画面的是
 * **每个资产实际用哪张图**（定版主图？回退到 FRONT 的图？还是压根没有文件）。
 * 声音同理：要能看到到底绑的是哪个音频文件，或者明确"这一镜还没有声音"。
 *
 * 数据来自出口 A 的只读接口（`previewPromptDelivery`，scope=本镜）——
 * **和「下载 TXT」用的是同一个端点、同一份数据**，所以这里看到的 =
 * 导出里写的 = 生成时会读到的那一份（不会出现"界面一套、导出另一套"）。
 */

import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Space, Tag, Tooltip, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { previewPromptDelivery } from '../../../../services/llmPipelineApi'
import { buildFileDownloadUrl, resolveAssetUrl } from '../../assets/utils'
// 阶段 B ①：后端原文 → 主区的中文结论（掩码 → 洗句 → 业务化改写三级管道）
import { toUserFacingText } from '../../components/userFacingMessage'

type BoundFileRow = {
  slot: string
  slot_label?: string
  asset_id: string
  asset_type: string
  asset_name: string
  file_id: string
  url: string
  is_primary: boolean
  resolved_from: string
  usable: boolean
  warnings?: string[]
}

type ShotBoundFilesPanelProps = {
  projectId?: string
  chapterId?: string | null
  shotId: string
}

/** 文件状态口径：定版 / 回退 / 非定版 / 无文件。 */
function resolveStatusMeta(row: BoundFileRow): { label: string; color: string } {
  if (!row.usable) return { label: '无可用文件', color: 'red' }
  if (row.is_primary) return { label: '定版', color: 'green' }
  if (row.resolved_from === 'fallback') return { label: '回退（非定版）', color: 'gold' }
  return { label: '非定版', color: 'default' }
}

export function ShotBoundFilesPanel({ projectId, chapterId, shotId }: ShotBoundFilesPanelProps) {
  const [rows, setRows] = useState<BoundFileRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!projectId || !shotId) return
    setLoading(true)
    setError('')
    try {
      // scope 用 episode + shot_ids 限定到本镜：既拿到"实际文件"，也拿到声音那一行
      const data = await previewPromptDelivery(projectId, chapterId, 'episode', [shotId])
      const row = (data?.rows ?? []).find((item) => item.shot_id === shotId)
      setRows(((row?.bound_files ?? []) as BoundFileRow[]) ?? [])
    } catch (err) {
      setRows([])
      // 审计 §4.3 模式 6：同文件 `:131`（warnings 出口）已经调了管道，这条路径口径要一致
      setError(toUserFacingText(err, '读取实际绑定文件失败'))
    } finally {
      setLoading(false)
    }
  }, [chapterId, projectId, shotId])

  useEffect(() => {
    void load()
  }, [load])

  const assetRows = rows.filter((row) => row.slot !== 'audio')
  const audioRow = rows.find((row) => row.slot === 'audio')

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="cs-group-title" style={{ marginBottom: 0 }}>
          实际使用的文件
        </div>
        <Space size={6}>
          <Typography.Text type="secondary" className="text-[11px]">
            与「下载 TXT」同一份数据
          </Typography.Text>
          <Tooltip title="只读刷新（不写库、不触网、不花钱）">
            <Button size="small" type="text" icon={<ReloadOutlined />} loading={loading} onClick={() => void load()} />
          </Tooltip>
        </Space>
      </div>

      {error ? <Alert type="warning" showIcon message={error} /> : null}

      {/* 用列表而不是表格：绑定项不多，逐条给出「谁 + 什么槽位 + 有没有可用文件」即可；
          原始 file_id 属于技术信息，统一放在工作区「技术详情」里，主界面不再刷屏。 */}
      <div className="space-y-2">
        {assetRows.length === 0 ? (
          <div className="text-[11px] text-gray-500">
            这一镜还没有绑定任何资产（或绑定的资产还没有图片文件）
          </div>
        ) : (
          assetRows.map((row) => {
            const meta = resolveStatusMeta(row)
            const src = row.url ? resolveAssetUrl(row.url) : row.file_id ? buildFileDownloadUrl(row.file_id) : ''
            return (
              <div
                key={`${row.slot}:${row.asset_id}`}
                className="flex items-start gap-2 rounded border border-slate-200 bg-white p-2"
              >
                {src ? (
                  <img
                    src={src}
                    alt=""
                    style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, border: '1px solid #e2e8f0', flexShrink: 0 }}
                  />
                ) : (
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded border border-dashed border-slate-300 text-[10px] text-gray-400">
                    无图
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span className="truncate text-xs">{row.asset_name || '（资产名称读取失败）'}</span>
                    <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>{meta.label}</Tag>
                  </div>
                  <div className="text-[10px] text-gray-500">
                    {`${row.slot_label || '本镜素材'} · ${row.file_id ? '文件已就绪' : '（无文件）'}（内部 ID 见「技术详情」）`}
                  </div>
                  {row.warnings?.length ? (
                    <div className="text-[10px] text-amber-600">{toUserFacingText(row.warnings[0], '这一项有需要注意的地方')}</div>
                  ) : null}
                </div>
              </div>
            )
          })
        )}

        <div className="rounded border border-slate-200 bg-white p-2">
          <div className="flex items-center gap-1">
            <Tag color="cyan" style={{ marginInlineEnd: 0 }}>声音</Tag>
            {audioRow ? (
              <span className="truncate text-xs">{audioRow.asset_name || '（声音名称读取失败）'}</span>
            ) : (
              <span className="text-xs text-gray-500">未绑定声音</span>
            )}
          </div>
          {audioRow ? (
            <div className="text-[10px] text-gray-500">
              {`${audioRow.file_id ? '音频文件已就绪' : '（无）'}（内部 ID 见「技术详情」）`}
            </div>
          ) : (
            <div className="text-[10px] text-gray-500">
              若本镜确实不需要声音，请在下面的「声音绑定」里明确选择，避免被当成漏绑。
            </div>
          )}
          {audioRow ? (
            <div className="text-[10px] text-gray-500">
              生成视频时公网地址的声音会作为参考音频进入请求；导出时这份绑定也会带出（含内部 ID）。
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default ShotBoundFilesPanel
