/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneCutIssue } from './SceneCutIssue';
/**
 * 人工画面结论与覆盖核对、声音状态分别表达。
 */
export type SceneCutReviewDecision = {
    verdict: 'pass' | 'revise';
    overall: string;
    established?: string;
    coverage_status: 'unknown' | 'gaps' | 'verified';
    coverage_notes?: string;
    issues?: Array<SceneCutIssue>;
    sound_status: 'pending_postproduction' | 'reviewed' | 'not_applicable';
    sound_notes?: string;
};
