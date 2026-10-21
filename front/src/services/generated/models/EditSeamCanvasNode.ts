/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasIssue } from './CanvasIssue';
import type { CanvasObject } from './CanvasObject';
import type { CanvasSummaryField } from './CanvasSummaryField';
import type { CanvasTarget } from './CanvasTarget';
import type { EditSeamReviewSummary } from './EditSeamReviewSummary';
/**
 * 真实相接的独立采用对；来源引用保留两侧素材与真实区间。
 */
export type EditSeamCanvasNode = {
    id: string;
    title: string;
    object: CanvasObject;
    summary: Array<CanvasSummaryField>;
    edit_target: (CanvasTarget | null);
    sources: Array<CanvasTarget>;
    issues: Array<CanvasIssue>;
    home_view_id: string;
    kind: 'edit_seam';
    left_clip_id: string;
    right_clip_id: string;
    review_status: 'applicable' | 'needs_review' | 'unreviewed' | 'failed';
    review: (EditSeamReviewSummary | null);
    review_issue: (string | null);
};
