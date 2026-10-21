/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasIssue } from './CanvasIssue';
import type { CanvasObject } from './CanvasObject';
import type { CanvasSummaryField } from './CanvasSummaryField';
import type { CanvasTarget } from './CanvasTarget';
import type { SceneCutReviewDecision } from './SceneCutReviewDecision';
/**
 * 整场固定结论摘要；问题保留全部真实片段身份。
 */
export type EditCutReviewCanvasNode = {
    id: string;
    title: string;
    object: CanvasObject;
    summary: Array<CanvasSummaryField>;
    edit_target: (CanvasTarget | null);
    sources: Array<CanvasTarget>;
    issues: Array<CanvasIssue>;
    home_view_id: string;
    kind: 'edit_cut_review';
    record_id: string;
    record_version_id: string;
    matches_current: boolean;
    decision: SceneCutReviewDecision;
};
