/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasIssue } from './CanvasIssue';
import type { CanvasObject } from './CanvasObject';
import type { CanvasSummaryField } from './CanvasSummaryField';
import type { CanvasTarget } from './CanvasTarget';
import type { MediaRange } from './MediaRange';
/**
 * 每次采用独立保存真实源区间、位置和片段适配。
 */
export type EditClipCanvasNode = {
    id: string;
    title: string;
    object: CanvasObject;
    summary: Array<CanvasSummaryField>;
    edit_target: (CanvasTarget | null);
    sources: Array<CanvasTarget>;
    issues: Array<CanvasIssue>;
    home_view_id: string;
    kind: 'edit_clip';
    clip_id: string;
    take_kind: 'production_plan' | 'scene_video';
    take_id: string;
    file_id: string;
    media_range: MediaRange;
    timeline_start_ms: number;
    fit: 'contain' | 'cover';
};
