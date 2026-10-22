/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasIssue } from './CanvasIssue';
import type { CanvasObject } from './CanvasObject';
import type { CanvasSummaryField } from './CanvasSummaryField';
import type { CanvasTarget } from './CanvasTarget';
import type { EditTakeReviewSummary } from './EditTakeReviewSummary';
import type { SceneTakeAnnotation_Output } from './SceneTakeAnnotation_Output';
/**
 * 共享素材的轻量固定来源；不展开完整生成输入或历史正文。
 */
export type EditTakeCanvasNode = {
    id: string;
    title: string;
    object: CanvasObject;
    summary: Array<CanvasSummaryField>;
    edit_target: (CanvasTarget | null);
    sources: Array<CanvasTarget>;
    issues: Array<CanvasIssue>;
    home_view_id: string;
    kind: 'edit_take';
    take_kind: 'production_plan' | 'scene_video';
    take_id: string;
    file_id: string;
    origin_id: (string | null);
    unit_id: (string | null);
    task_id: (string | null);
    available: boolean;
    duration_ms: (number | null);
    annotation: (SceneTakeAnnotation_Output | null);
    reviews: Array<EditTakeReviewSummary>;
};
