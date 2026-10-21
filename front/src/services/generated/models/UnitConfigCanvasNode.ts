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
import type { VideoReferenceCapabilities } from './VideoReferenceCapabilities';
/**
 * 四类配置的稳定编辑地址，不将配置转成任意 JSON 表单。
 */
export type UnitConfigCanvasNode = {
    id: string;
    title: string;
    object: CanvasObject;
    summary: Array<CanvasSummaryField>;
    edit_target: (CanvasTarget | null);
    sources: Array<CanvasTarget>;
    issues: Array<CanvasIssue>;
    home_view_id: string;
    kind: 'unit_config';
    unit_id: string;
    config_kind: 'coverage' | 'generation' | 'organization' | 'dependencies';
    coverage_item_id: (string | null);
    shot_id: (string | null);
    fields: Array<string>;
    dependency_evidence: Array<(CanvasPlanDependency | CanvasSceneDependency)>;
    reference_capabilities: (VideoReferenceCapabilities | null);
    capability_error: (string | null);
};
