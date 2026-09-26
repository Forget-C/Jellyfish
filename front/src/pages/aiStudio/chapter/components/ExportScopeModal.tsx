/**
 * 导出前的范围检查弹窗（第二部分要求）。
 *
 * 为什么需要：直接开 TXT 会让用户拿到一份"缺提示词/缺绑定文件"的交付包却不知道缺在哪。
 * 这里先按**导出条件**（不是生成条件）分类列出：
 * - 可导出：有提示词且来源在白名单内（**不要求生成过视频，也不要求关键帧齐全**）；
 * - 缺提示词：没有正文或来源不可导出；
 * - 缺绑定文件：可以导出，但必须如实标注"这一镜没有实际绑定文件"。
 * 用户选择「只导出已就绪镜头」或「返回补齐」，确认后才调用既有 TXT 接口。
 */

import { useMemo } from 'react'
import { Alert, Button, Modal, Space, Table, Tag, Typography } from 'antd'
import type { ShotReadiness } from './shotReadiness'

type ExportScopeModalProps = {
  open: boolean
  onClose: () => void
  /** 范围内每个镜头的就绪结果（与进度条、生产卡同一套判断） */
  readiness: ShotReadiness[]
  /** 用户确认导出：传入最终选择的镜头范围 */
  onConfirm: (shotIds: string[]) => void
  chapterLabel?: string
}

export function ExportScopeModal({ open, onClose, readiness, onConfirm, chapterLabel }: ExportScopeModalProps) {
  const ready = useMemo(() => readiness.filter((item) => item.canExport), [readiness])
  const missingPrompt = useMemo(() => readiness.filter((item) => !item.canExport), [readiness])
  const missingFiles = useMemo(
    () => readiness.filter((item) => item.canExport && item.exportWarnings.length > 0),
    [readiness],
  )

  // 下载范围**只包含可导出镜头**：缺提示词/来源不合法的镜头不进 TXT（避免"看着能导、后端静默跳过"）
  const finalShotIds = useMemo(() => ready.map((item) => item.shotId), [ready])

  return (
    <Modal
      title={`导出绑定提示词 · 范围检查${chapterLabel ? ` · ${chapterLabel}` : ''}`}
      open={open}
      onCancel={onClose}
      width={880}
      footer={
        <Space>
          <Button onClick={onClose}>返回补齐</Button>
          <Button type="primary" disabled={!finalShotIds.length} onClick={() => onConfirm(finalShotIds)}>
            {`只导出可导出镜头（${ready.length}）`}
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        className="mb-3"
        message="导出条件与生成条件不同"
        description="只要这一镜有正式保存的提示词就能导出：不要求已经生成过视频，也不要求关键帧齐全；缺绑定文件会照常导出，但会在导出内容里标注出来。"
      />

      <Space wrap size={12} className="mb-2">
        <Tag color="green">可导出（将进入 TXT）{ready.length}</Tag>
        <Tag color={missingPrompt.length ? 'red' : 'default'}>缺提示词 {missingPrompt.length}</Tag>
        <Tag color={missingFiles.length ? 'gold' : 'default'}>缺绑定文件 {missingFiles.length}</Tag>
      </Space>

      <Table<ShotReadiness>
        size="small"
        rowKey="shotId"
        pagination={false}
        scroll={{ y: 320 }}
        dataSource={readiness}
        columns={[
          { title: '镜头', dataIndex: 'code', width: 70 },
          { title: '镜头内容', dataIndex: 'title', ellipsis: true },
          {
            title: '导出判定',
            width: 110,
            render: (_value, row) => (row.canExport ? <Tag color="green">可导出</Tag> : <Tag color="red">缺提示词</Tag>),
          },
          {
            title: '缺项 / 标注',
            render: (_value, row) =>
              row.exportWarnings.length ? (
                <span className="text-[11px] text-amber-600">{row.exportWarnings.join('；')}</span>
              ) : (
                <span className="text-[11px] text-gray-400">—</span>
              ),
          },
          {
            title: '生成',
            width: 100,
            render: (_value, row) => (row.canGenerate ? <Tag color="green">可生成</Tag> : <Tag>待补齐</Tag>),
          },
        ]}
      />

      <Typography.Text type="secondary" className="text-[11px]">
        确认后将调用既有 TXT 导出接口，只包含最终选中的镜头，并带出提示词、来源与绑定文件的实际信息。
      </Typography.Text>
    </Modal>
  )
}

export default ExportScopeModal
