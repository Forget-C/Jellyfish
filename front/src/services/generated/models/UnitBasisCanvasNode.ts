/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasBasisTarget } from './CanvasBasisTarget';
import type { CanvasIssue } from './CanvasIssue';
import type { CanvasObject } from './CanvasObject';
import type { CanvasSummaryField } from './CanvasSummaryField';
import type { CanvasTarget } from './CanvasTarget';
import type { UnitScopeProjection_Output } from './UnitScopeProjection_Output';
/**
 * 只读范围沿用指令的实际消费投影；不另行沿图推断执行内容。
 */
export type UnitBasisCanvasNode = {
    id: string;
    title: string;
    object: CanvasObject;
    summary: Array<CanvasSummaryField>;
    edit_target: (CanvasTarget | null);
    sources: Array<CanvasTarget>;
    issues: Array<CanvasIssue>;
    home_view_id: string;
    kind: 'unit_basis';
    unit_id: string;
    scope: UnitScopeProjection_Output;
    field_targets: Array<CanvasBasisTarget>;
};
