/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasIssue } from './CanvasIssue';
import type { CanvasObject } from './CanvasObject';
import type { CanvasSummaryField } from './CanvasSummaryField';
import type { CanvasTarget } from './CanvasTarget';
import type { SceneActualCoverage_Output } from './SceneActualCoverage_Output';
/**
 * 人工观察与当前方案目标；不从生成计划推测实际覆盖。
 */
export type EditCoverageCanvasNode = {
    id: string;
    title: string;
    object: CanvasObject;
    summary: Array<CanvasSummaryField>;
    edit_target: (CanvasTarget | null);
    sources: Array<CanvasTarget>;
    issues: Array<CanvasIssue>;
    home_view_id: string;
    kind: 'edit_coverage';
    take_kind: 'production_plan' | 'scene_video';
    take_id: string;
    coverage: SceneActualCoverage_Output;
};
