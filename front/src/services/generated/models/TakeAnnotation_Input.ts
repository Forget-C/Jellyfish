/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ActualCoverage_Input } from './ActualCoverage_Input';
import type { MediaRange } from './MediaRange';
import type { Note_Input } from './Note_Input';
/**
 * 素材审查与是否采用独立；保/修可保留局部。
 */
export type TakeAnnotation_Input = {
    coverage: Array<ActualCoverage_Input>;
    review_status: 'unreviewed' | 'reviewed';
    verdict?: ('pass' | 'retain' | 'repair' | 'discard' | null);
    rationale: Note_Input;
    retained_ranges: Array<MediaRange>;
};

