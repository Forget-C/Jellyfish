import { useMemo, useState } from 'react'
import { Button, Empty, Segmented, Space } from 'antd'
import type { ProductionPlan_Input, WorkspaceRead } from '../../../services/generated'
import { buildProductionGraph, type ProductionGraphNode } from './productionGraph'

const column = (node: ProductionGraphNode) => ['coverage', 'reference', 'dependency'].includes(node.kind) ? 0 : node.kind === 'unit' ? 1 : node.kind === 'take' ? 3 : 2
const titles = ['输入与依赖', '生产单元', '指令与检查', '候选产出']
const edgeLabels = { coverage: '覆盖', reference: '参考输入', dependency: '落幅依赖', prompt: '编译依据', review: '检查对象', take: '生成来源' }

/** 自动布局的只读关系投影；节点操作交给原有编辑器和明确的版本选择边界。 */
export function ProductionRelationGraph({ workspace, planId, plan, unitId, onSelect }: {
  workspace: WorkspaceRead; planId: string; plan: ProductionPlan_Input; unitId?: string;
  onSelect: (node: ProductionGraphNode) => void
}) {
  const [scope, setScope] = useState('unit')
  const [selected, setSelected] = useState('')
  const unit = plan.units.find(row => row.id === unitId)
  const missingInputs = unit && scope === 'unit' ? [!unit.coverage.length && '尚未配置镜头范围', !unit.references.length && '未选择参考（可选）', !unit.dependencies?.length && '无前段落幅依赖（可选）'].filter(Boolean) : []
  const graph = useMemo(() => buildProductionGraph(workspace, planId, plan, scope === 'unit' ? unitId : undefined), [workspace, planId, plan, scope, unitId])
  const columns = titles.map((_, index) => graph.nodes.filter(node => column(node) === index))
  const positions = new Map(columns.flatMap((nodes, index) => nodes.map((node, row) => [node.id, { x: index * 208 + 8, y: row * 120 + 40 }] as const)))
  const height = Math.max(240, ...columns.map(nodes => nodes.length * 120 + 48))
  const choose = (node: ProductionGraphNode) => { setSelected(node.id); onSelect(node) }
  return <section className="production-relation-graph" aria-label="试拍关系图">
    <Space wrap className="production-graph-toolbar"><Segmented aria-label="试拍关系范围" value={scope} onChange={value => setScope(String(value))}
      options={[{ value: 'unit', label: '当前单元' }, { value: 'all', label: '全场关系' }]} /><span>点击对象查看输入或产出</span></Space>
    {unitId && <Space wrap className="production-graph-toolbar">{(['coverage', 'reference', 'dependency', 'unit'] as const).map(kind => <Button key={kind} size="small" onClick={() => onSelect({ id: '', kind, label: '', detail: '', planId, unitId, objectId: '' })}>{{ coverage: '镜头范围', reference: '参考输入', dependency: '落幅依赖', unit: '单元参数' }[kind]}</Button>)}</Space>}
    {!!missingInputs.length && <p className="design-secondary">{missingInputs.join(' · ')}</p>}
    {!graph.nodes.length ? <Empty description="先添加生产单元" /> : <div className="production-graph-scroll"><div className="production-graph-canvas" style={{ height }}>
      <svg width="100%" height={height} viewBox={`0 0 840 ${height}`} preserveAspectRatio="none" aria-hidden="true">{graph.edges.map(edge => {
        const from = positions.get(edge.from), to = positions.get(edge.to)
        if (!from || !to) return null
        const x = from.x + 176, y = from.y + 52, targetX = to.x, targetY = to.y + 52
        return <path key={`${edge.kind}:${edge.from}:${edge.to}`} data-edge-kind={edge.kind} className={selected === edge.from || selected === edge.to ? 'is-selected' : ''}
          d={`M ${x} ${y} C ${x + 20} ${y}, ${targetX - 20} ${targetY}, ${targetX} ${targetY}`} />
      })}</svg>
      {columns.map((nodes, index) => <section key={titles[index]} className="production-graph-column" style={{ left: `calc(${index * 25}% + 8px)` }}>
        <h3>{titles[index]}</h3>
        {!nodes.length && <p className="production-graph-empty">{index === 0 ? '未配置输入' : index === 2 ? '尚未生成指令' : index === 3 ? '尚无候选' : '尚无单元'}</p>}
        {nodes.map(node => <div key={node.id} className="production-graph-node" data-node-kind={node.kind}>
          <Button aria-pressed={selected === node.id} onClick={() => choose(node)}><strong>{node.label}</strong><span>{node.detail}</span>{node.external && <small>固定外部来源</small>}</Button>
          <span className="production-graph-connections">{graph.edges.filter(edge => edge.to === node.id).map(edge => `${edgeLabels[edge.kind]}：${graph.nodes.find(row => row.id === edge.from)?.label}`).join('；')}</span>
        </div>)}
      </section>)}
    </div></div>}
  </section>
}
