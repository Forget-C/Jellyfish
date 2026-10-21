/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasIssue } from './CanvasIssue';
import type { CanvasObject } from './CanvasObject';
import type { CanvasSummaryField } from './CanvasSummaryField';
import type { CanvasTarget } from './CanvasTarget';
import type { SceneEndFrameRead } from './SceneEndFrameRead';
/**
 * 当前采用相关实际落幅及其不可改写的来源。
 */
export type EditEndFrameCanvasNode = {
    id: string;
    title: string;
    object: CanvasObject;
    summary: Array<CanvasSummaryField>;
    edit_target: (CanvasTarget | null);
    sources: Array<CanvasTarget>;
    issues: Array<CanvasIssue>;
    home_view_id: string;
    kind: 'edit_end_frame';
    frame: SceneEndFrameRead;
};
