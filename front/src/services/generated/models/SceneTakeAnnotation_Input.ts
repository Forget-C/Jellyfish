/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MediaRange } from './MediaRange';
import type { Note_Input } from './Note_Input';
import type { SceneActualCoverage_Input } from './SceneActualCoverage_Input';
/**
 * 当前方案观察；素材审查和是否剪辑采用仍分别表达。
 */
export type SceneTakeAnnotation_Input = {
    coverage: Array<SceneActualCoverage_Input>;
    review_status: 'unreviewed' | 'reviewed';
    verdict?: ('pass' | 'retain' | 'repair' | 'discard' | null);
    rationale: Note_Input;
    retained_ranges: Array<MediaRange>;
};
