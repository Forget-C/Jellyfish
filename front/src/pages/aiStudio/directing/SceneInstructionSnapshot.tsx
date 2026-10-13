import type { SceneInstructionSuggestionRead } from '../../../services/generated'
import { DesignFields } from './DesignFields'
import { SourceLinks } from './Sources'
import { designLabels } from './designLabels'
import { referencePurposes } from './referenceInput'

/** 展示原任务保存的输入，不查询当前配置或应用建议。 */
export function SceneInstructionSnapshot({ selected }: { selected: SceneInstructionSuggestionRead }) {
  return <details><summary>查看本次固定输入</summary><p>{selected.basis.text}</p>
        <SourceLinks sources={[selected.basis.source]} />
        <p>指令生成模型：{selected.generation_model_name || '当次名称未记录'}</p>
        <p>视频模型：{selected.video_model_name || '当次名称未记录'}</p>
        <details><summary>当次六岗设计</summary>
          <p>以下为提交时的只读设计，查看不会覆盖当前工作。</p>
          <SourceLinks sources={selected.design.sources} />
          <DesignFields value={selected.design} path={[]} disabled onChange={() => {}} />
        </details>
        <details><summary>当次适用风格</summary>
          {selected.style_rules == null ? <p>当次风格输入未记录，不能用当前风格代替。</p> : !selected.style_rules.length ? <p>当次没有适用的已确认风格规则。</p> : selected.style_rules.map(rule => <section key={rule.id}>
            <h4>{designLabels[rule.role]}</h4><p>{rule.requirement}</p><SourceLinks sources={rule.sources} />
            <p>例外：{rule.exceptions?.text || rule.exceptions?.reason || '未填写'}</p>
            {!!rule.exceptions?.sources?.length && <SourceLinks sources={rule.exceptions.sources} />}
            <details><summary>规则适用范围与身份</summary><p>规则：{rule.id}</p><p>场次：{rule.sequence_ids?.join('、') || '项目通用'}</p><p>模型：{rule.model_names?.join('、') || '不限模型'}</p></details>
          </section>)}
        </details>
        <p>{selected.unit.coverage.map(item => item.action_scope).join('；')}</p>
        <p>{selected.unit.ratio} · {selected.unit.duration_ms == null ? '未填时长' : `${selected.unit.duration_ms / 1000} 秒`}</p>
        <details><summary>固定输入身份与关联</summary>
          <p>指令模型：{selected.generation_model_id || '未记录'}；视频模型：{selected.unit.model_id}</p>
          <p>单元：{selected.unit.id}；风格版本：{selected.design.style_revision_id || '未绑定'}</p>
          <p>原文范围：{selected.basis.start ?? '未记录'}–{selected.basis.end ?? '未记录'}</p>
          {selected.unit.coverage.map(item => <p key={item.id}>覆盖：{item.id}；镜头：{item.shot_id}；节拍：{item.beat_ids.join('、') || '无'}；事件：{item.event_ids.join('、') || '无'}</p>)}
          {selected.unit.dependencies.length ? selected.unit.dependencies.map((item, index) => <p key={index}>前段依赖 {index + 1}：拍摄依据 {item.plan_revision_id}；单元 {item.unit_id}；实际落幅 {item.frame_id || '未绑定'}；参考 {item.reference_id || '未绑定'}</p>) : <p>当次没有前段依赖。</p>}
          <p>多镜能力记录：{({ supported: '支持', unsupported: '不支持', unknown: '待核实' })[selected.unit.capability.multi_shot || 'unknown']}</p>
          <p>参考类型记录：{selected.unit.capability.reference_kinds?.map(kind => ({ image: '图片', video: '视频', audio: '声音' })[kind]).join('、') || '未记录'}</p>
          {selected.unit.capability.evidence && <SourceLinks sources={[selected.unit.capability.evidence]} />}
        </details>
        <p>参数：{Object.entries(selected.unit.parameters).map(([name, value]) => `${name}=${String(value)}`).join('；') || '使用模型默认参数'}</p>
        <p>{selected.requirements || '未补充编写要求'}</p><p>固定参考：{selected.unit.references.length} 项</p>
        {selected.unit.references.map(reference => <section key={reference.id}><p>{reference.asset_origin?.name || reference.file_id} · {({ image: '图片', video: '视频', audio: '声音' })[reference.media_kind]} · {referencePurposes[reference.purpose]}</p>
          <p>输入角色：{reference.input_role ? ({ subject: '主体参考', first_frame: '起始画面', last_frame: '结束画面', key_frame: '关键画面' })[reference.input_role] : '未记录'}</p>
          <p>绑定对象：{reference.participant_ids.map(id => selected.design.participants.find(item => item.id === id)?.name || id).join('、') || '无'}</p>
          <SourceLinks sources={[reference.source]} />
          <details><summary>参考输入身份</summary><p>参考：{reference.id}；文件：{reference.file_id}；顺序：{reference.ordinal}；主体组：{reference.subject_group_id || '无'}</p></details>
        </section>)}
      </details>
}
