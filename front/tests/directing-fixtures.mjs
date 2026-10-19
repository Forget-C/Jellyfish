import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Use the project's TypeScript compiler; these modules contain only pure logic and type imports.
export async function loadSource(name) {
  const source = await readFile(new URL(`../src/pages/aiStudio/directing/${name}.ts`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } })
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}

const { emptyDesign } = await loadSource('designTemplate')
export function revision(id, content, confirmed = true) {
  return { id, project_id: 'p1', chapter_id: 'ch1', sequence_id: 's1', parent_id: null, version: confirmed ? 2 : 1, confirmed_at: confirmed ? '2026-09-15T01:00:00' : null, confirmed_by: confirmed ? 'author' : null, source_current: true, content }
}
export function clip(id, takeId, start, end, timeline = 0) {
  return { kind: 'media', id, take_id: takeId, media_range: { source_in_ms: start, source_out_ms: end }, timeline_start_ms: timeline }
}
export function makeWorkspace() {
  const design = emptyDesign()
  // Existing fixture models a historical design saved before independent rows had IDs.
  delete design.performance.situations[0].id
  delete design.performance.beats[0].id
  delete design.staging.activities[0].id
  delete design.cinematography[0].id
  design.direction.information_change = { state: 'fact', text: '递出旧信，认出对方', sources: [] }
  const plan = { design_revision_id: 'd1', units: [{ id: 'u1', coverage: [{ id: 'cover1', shot_id: 'shot1', beat_ids: ['beat1'], event_ids: ['event1'], action_scope: '递出旧信' }], references: [], dependencies: [], model_id: 'model1', duration_ms: 6000, ratio: '16:9', parameters: {}, capability: { multi_shot: 'unknown' } }] }
  const takes = ['t1', 't2', 't3'].map((id, index) => ({ id, display_number: index + 1, project_id: 'p1', chapter_id: 'ch1', sequence_id: 's1', plan_revision_id: 'p-old', unit_id: 'u1', prompt_revision_id: 'prompt1', task_id: `task${index}`, output_ordinal: 0, file_id: `file${index}`, version: 1, annotation: { review_status: index === 2 ? 'unreviewed' : 'reviewed', verdict: index === 2 ? null : index === 0 ? 'retain' : 'pass', rationale: { state: 'unset' }, coverage: [], retained_ranges: [] } }))
  return {
    sequence: { id: 's1', project_id: 'p1', chapter_id: 'ch1', title: 'UX1 隔离验收场次', position: 0, version: 1, source: { kind: 'human', reference: 'sample', version: '1' }, source_text: '他递出旧信，她认出了他。', span: null, source_changed: false },
    designs: [revision('d1', design), revision('d2', structuredClone(design), false)],
    plans: [revision('p-old', plan), revision('p-new', structuredClone(plan), false)],
    prompts: [], reviews: [], takes, task_ids: [],
    cuts: [revision('c-old', { items: [clip('old', 't2', 0, 1000)] }), revision('c-active', { items: [clip('a', 't1', 1000, 2000), clip('b', 't1', 4000, 5000, 1000), { kind: 'planned', id: 'pre', design_revision_id: 'd1', shot_id: 'shot1', estimated_duration_ms: 3000, timeline_start_ms: 2000, dialogue_cues: [] }] }), revision('c-draft', { items: [] }, false)],
  }
}
