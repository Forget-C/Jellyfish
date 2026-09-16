import { Card, Space, Typography } from 'antd'
import { SourceLinks } from './Sources'
import { FrozenDesignValue } from './PromptReader'
import type { Note_Output, ReviewRow, SceneDesign_Input } from '../../../services/generated'
import { designLabels } from './designLabels'

/** 使用原字段的层级与位置命名，不将未知路径映射到相似对象。 */
export function reviewPathLabel(path: string) {
  return path.startsWith('/') ? path.slice(1).split('/').map(key => /^\d+$/.test(key) ? `第${Number(key) + 1}项` : designLabels[key] || '未识别字段').join(' · ') : '无法识别的字段路径'
}

const states = { unset: '未填写', unknown: '待确定', not_applicable: '不适用', none: '明确没有', fact: '已知事实', proposal: '建议' }

/** 原样呈现已保存的状态和来源，不将缺失信息补成事实或人工批准。 */
function ReviewNote({ label, note }: { label: string; note: Note_Output }) {
  return <div>
    <Typography.Text strong>{label} · {states[note.state || 'unset']}</Typography.Text>
    <p style={{ whiteSpace: 'pre-wrap' }}>{note.text || note.reason || '未提供内容'}</p>
    {note.sources?.length ? <SourceLinks sources={note.sources} /> : <Typography.Text type="secondary">未提供来源</Typography.Text>}
  </div>
}

/** 审稿结果、执行取舍和台账共用详情；字段路径仅展示，不猜测或跳转设计版本。 */
export function ReviewDetails({ row, design, compact = false, hideRationale = false, onInspect }: { row: ReviewRow; design?: SceneDesign_Input; compact?: boolean; hideRationale?: boolean; onInspect?: (paths: string[]) => void }) {
  if (compact) return <div className="shoot-review-findings">
    {!hideRationale && <p>{row.rationale || '未提供结论说明'}</p>}
    {row.findings.map((finding, index) => <section key={index}>
      <p><strong>观察{row.findings.length > 1 ? ` ${index + 1}` : ''}：</strong>{finding.observation || '未提供观察内容'}</p>
      <p><strong>建议：</strong>{finding.suggestion.text || finding.suggestion.reason || '未提供修改建议'}<small> · {states[finding.suggestion.state || 'unset']}</small></p>
      <details><summary>验收条件与来源</summary><ReviewNote label="修改建议" note={finding.suggestion} /><ReviewNote label="验收条件" note={finding.acceptance} />
        {finding.affected_paths.map((path, i) => <details key={i}><summary>{reviewPathLabel(path)}</summary><FrozenDesignValue design={design} pointer={path} /><code>{path}</code></details>)}
        {!finding.affected_paths.length && <p>未指定影响对象</p>}
      </details>
      {!!finding.affected_paths.length && onInspect && <button type="button" className="shoot-text-action" onClick={() => onInspect(finding.affected_paths)}>查看相关指令与固定依据</button>}
    </section>)}
    {!row.findings.length && <p className="design-secondary">未提供具体问题详情，结论以原检查状态为准。</p>}
  </div>
  return <>
    <p style={{ whiteSpace: 'pre-wrap' }}>{row.rationale}</p>
    {row.findings.length ? <details><summary>查看问题详情（{row.findings.length}）</summary>
      <Space direction="vertical" className="w-full">{row.findings.map((finding, index) => <Card key={index} size="small" title={`问题 ${index + 1}`}>
        <Typography.Text strong>观察</Typography.Text><p style={{ whiteSpace: 'pre-wrap' }}>{finding.observation}</p>
        <Typography.Text strong>影响对象（原字段路径）</Typography.Text>
        {finding.affected_paths.length ? <ul>{finding.affected_paths.map((path, i) => <li key={i}><details><summary><Typography.Text code>{path}</Typography.Text></summary>{design ? <FrozenDesignValue design={design} pointer={path} /> : <p>此处仅展示审稿原始路径，未载入对应冻结设计。</p>}</details></li>)}</ul> : <p>未指定影响对象</p>}
        <ReviewNote label="修改建议" note={finding.suggestion} />
        <ReviewNote label="验收条件" note={finding.acceptance} />
      </Card>)}</Space>
    </details> : <Typography.Text type="secondary">本项未列出具体问题；结论以审稿状态为准。</Typography.Text>}
  </>
}
