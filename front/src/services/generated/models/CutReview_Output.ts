/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CutIssue_Output } from './CutIssue_Output';
import type { Note_Output } from './Note_Output';
import type { ObservedRange } from './ObservedRange';
/**
 * 整场审片固定剪辑版本；画面通过不代表声音已经完成。
 */
export type CutReview_Output = {
    cut_revision_id: string;
    verdict: 'pass' | 'revise';
    overall: Note_Output;
    established: Note_Output;
    missing_coverage: Note_Output;
    usable_ranges: Array<ObservedRange>;
    awaiting_evidence: Note_Output;
    sound_status: 'pending_postproduction' | 'reviewed' | 'not_applicable';
    sound_observation: Note_Output;
    issues: Array<CutIssue_Output>;
};
