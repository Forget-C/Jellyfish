/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MediaRange } from './MediaRange';
import type { Note_Output } from './Note_Output';
import type { SceneActualCoverage_Output } from './SceneActualCoverage_Output';
/**
 * 当前方案观察；素材审查和是否剪辑采用仍分别表达。
 */
export type SceneTakeAnnotation_Output = {
    coverage: Array<SceneActualCoverage_Output>;
    review_status: 'unreviewed' | 'reviewed';
    verdict?: ('pass' | 'retain' | 'repair' | 'discard' | null);
    rationale: Note_Output;
    retained_ranges: Array<MediaRange>;
};
