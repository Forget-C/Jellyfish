import { useState } from 'react'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { WorkbenchTheme } from './WorkbenchTheme'
import { WorkbenchButton, WorkbenchIconButton } from './WorkbenchButton'
import { WorkbenchDialogActions, WorkbenchModal } from './WorkbenchModal'
import { CanvasTextPreview } from './CanvasTextPreview'

/** 开发环境中的真实组件状态样例，不请求业务数据或提交生成任务。 */
export default function WorkbenchExamples() {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(false)
  return <WorkbenchTheme><main className="workbench-ui wb-examples">
    <h1>工作台组件标准</h1><p>使用与场次工作台相同的组件、主题和交互。</p>
    <section aria-label="动作状态"><h2>动作层级与状态</h2><div className="wb-example-row">
      <WorkbenchButton variant="primary">生成设计</WorkbenchButton>
      <WorkbenchButton icon={<PlusOutlined aria-hidden="true" />}>发起新设计</WorkbenchButton>
      <WorkbenchButton variant="quiet">取消</WorkbenchButton>
      <WorkbenchButton variant="danger">删除</WorkbenchButton>
      <WorkbenchButton variant="primary" disabled>不可应用</WorkbenchButton>
      <WorkbenchButton variant="primary" loading>生成中</WorkbenchButton>
      <WorkbenchIconButton label="刷新" variant="quiet" icon={<ReloadOutlined aria-hidden="true" />} />
      <WorkbenchButton aria-pressed={selected} onClick={() => setSelected(value => !value)}>选择范围</WorkbenchButton>
    </div></section>
    <section><h2>文本与辅助信息</h2><p className="wb-example-caption">短文本不出现展开按钮；长文本原位展开，保持单份正文。</p>
      <CanvasTextPreview text="一段简短的原文。" label="短文" lines={4} />
      <CanvasTextPreview text={'他把旧信放在桌上，她缓缓抬头。\n'.repeat(20)} label="示例原文" lines={4} />
    </section>
    <section><h2>弹窗与固定主动作</h2><WorkbenchButton onClick={() => setOpen(true)}>打开示例弹窗</WorkbenchButton></section>
    <WorkbenchModal title="组件状态示例" open={open} onCancel={() => setOpen(false)} footer={<WorkbenchDialogActions secondary={<WorkbenchButton variant="quiet" onClick={() => setOpen(false)}>取消</WorkbenchButton>}><WorkbenchButton variant="primary" onClick={() => setOpen(false)}>完成检查</WorkbenchButton></WorkbenchDialogActions>}>
      <h3>原文依据</h3><CanvasTextPreview text={'这是一段用于检查滚动区域的原文。\n'.repeat(60)} label="弹窗原文" lines={4} />
      <h3>设计要求 <span className="wb-example-caption">未填写</span></h3>
    </WorkbenchModal>
  </main></WorkbenchTheme>
}
