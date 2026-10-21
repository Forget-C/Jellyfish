/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasIssue } from './CanvasIssue';
import type { CanvasObject } from './CanvasObject';
import type { CanvasPlanDependency } from './CanvasPlanDependency';
import type { CanvasSceneDependency } from './CanvasSceneDependency';
import type { CanvasSummaryField } from './CanvasSummaryField';
import type { CanvasTarget } from './CanvasTarget';
/**
 * 明确后段绑定及现有依赖核验，不推断补拍计划。
 */
export type EditDownstreamCanvasNode = {
    id: string;
    title: string;
    object: CanvasObject;
    summary: Array<CanvasSummaryField>;
    edit_target: (CanvasTarget | null);
    sources: Array<CanvasTarget>;
    issues: Array<CanvasIssue>;
    home_view_id: string;
    kind: 'edit_downstream';
    unit_id: string;
    dependency: (CanvasPlanDependency | CanvasSceneDependency);
};
