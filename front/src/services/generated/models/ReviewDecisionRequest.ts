/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 明确记录人工艺术取舍，结构和能力检查仍不可绕过。
 */
export type ReviewDecisionRequest = {
    role: 'direction' | 'performance' | 'staging' | 'cinematography' | 'continuity' | 'prompt';
    occurrence_id: string;
    reason: string;
};

