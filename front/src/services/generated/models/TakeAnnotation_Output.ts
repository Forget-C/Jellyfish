/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ActualCoverage_Output } from './ActualCoverage_Output';
import type { MediaRange } from './MediaRange';
import type { Note_Output } from './Note_Output';
/**
 * 素材审查与是否采用独立；保/修可保留局部。
 */
export type TakeAnnotation_Output = {
    coverage: Array<ActualCoverage_Output>;
    review_status: 'unreviewed' | 'reviewed';
    verdict?: ('pass' | 'retain' | 'repair' | 'discard' | null);
    rationale: Note_Output;
    retained_ranges: Array<MediaRange>;
};
