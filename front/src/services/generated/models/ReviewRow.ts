/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ReviewFinding } from './ReviewFinding';
/**
 * 一个岗位对一个出现项的检查，pending 不等于通过。
 */
export type ReviewRow = {
    role: 'direction' | 'performance' | 'staging' | 'cinematography' | 'continuity' | 'prompt';
    occurrence_id: string;
    verdict: 'pending' | 'pass' | 'revise';
    rationale: string;
    findings: Array<ReviewFinding>;
};
