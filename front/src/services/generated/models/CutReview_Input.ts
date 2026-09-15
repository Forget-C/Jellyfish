/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CutIssue_Input } from './CutIssue_Input';
import type { Note_Input } from './Note_Input';
import type { ObservedRange } from './ObservedRange';
/**
 * 整场审片固定剪辑版本；画面通过不代表声音已经完成。
 */
export type CutReview_Input = {
    cut_revision_id: string;
    verdict: 'pass' | 'revise';
    overall: Note_Input;
    established: Note_Input;
    missing_coverage: Note_Input;
    usable_ranges: Array<ObservedRange>;
    awaiting_evidence: Note_Input;
    sound_status: 'pending_postproduction' | 'reviewed' | 'not_applicable';
    sound_observation: Note_Input;
    issues: Array<CutIssue_Input>;
};
