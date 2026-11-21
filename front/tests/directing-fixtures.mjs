import { loadFrontendModule } from './load-frontend-module.mjs'

export function loadSource(name) {
  return loadFrontendModule('pages/aiStudio/directing/' + name)
}

export function makeSequence(title = 'UX1 隔离验收场次') {
  return {
    id: 's1', project_id: 'p1', chapter_id: 'ch1', title, position: 0, version: 1,
    source: { kind: 'human', reference: 'sample', version: '1' },
    source_text: '他递出旧信，她认出了他。', span: null, source_changed: false, is_current: true,
  }
}
