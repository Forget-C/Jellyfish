import { Card, Space, Typography } from 'antd'
import type { Note_Output, ReviewRow } from '../../../services/generated'

const states = { unset: '未填写', unknown: '待确定', not_applicable: '不适用', none: '明确没有', fact: '已知事实', proposal: '建议' }
const sourceKinds = { human: '人工', chapter: '章节原文', model: '模型', file: '文件', revision: '版本记录' }

/** 原样呈现已保存的状态和来源，不将缺失信息补成事实或人工批准。 */
function ReviewNote({ label, note }: { label: string; note: Note_Output }) {
  return <div>
    <Typography.Text strong>{label} · {states[note.state || 'unset']}</Typography.Text>
    <p style={{ whiteSpace: 'pre-wrap' }}>{note.text || note.reason || '未提供内容'}</p>
    {note.sources?.length ? note.sources.map((source, index) => <p key={index}>
      来源：{sourceKinds[source.kind]} · {source.reference} · 版本 {source.version}
      {source.file_id && <> · 文件 {source.file_id}</>}
      {source.media_range && <> · {source.media_range.source_in_ms / 1000}–{source.media_range.source_out_ms / 1000} 秒</>}
    </p>) : <Typography.Text type="secondary">未提供来源</Typography.Text>}
  </div>
}

/** 审稿结果、执行取舍和台账共用详情；字段路径仅展示，不猜测或跳转设计版本。 */
export function ReviewDetails({ row }: { row: ReviewRow }) {
  return <>
    <p style={{ whiteSpace: 'pre-wrap' }}>{row.rationale}</p>
    {row.findings.length ? <details><summary>查看问题详情（{row.findings.length}）</summary>
      <Space direction="vertical" className="w-full">{row.findings.map((finding, index) => <Card key={index} size="small" title={`问题 ${index + 1}`}>
        <Typography.Text strong>观察</Typography.Text><p style={{ whiteSpace: 'pre-wrap' }}>{finding.observation}</p>
        <Typography.Text strong>影响对象（原字段路径）</Typography.Text>
        {finding.affected_paths.length ? <ul>{finding.affected_paths.map((path, i) => <li key={i}><Typography.Text code>{path}</Typography.Text></li>)}</ul> : <p>未指定影响对象</p>}
        <ReviewNote label="修改建议" note={finding.suggestion} />
        <ReviewNote label="验收条件" note={finding.acceptance} />
      </Card>)}</Space>
    </details> : <Typography.Text type="secondary">本项未列出具体问题；结论以审稿状态为准。</Typography.Text>}
  </>
}
