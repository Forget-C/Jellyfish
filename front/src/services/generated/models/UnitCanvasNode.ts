/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasIssue } from './CanvasIssue';
import type { CanvasObject } from './CanvasObject';
import type { CanvasSummaryField } from './CanvasSummaryField';
import type { CanvasTarget } from './CanvasTarget';
/**
 * 一个生产单元只有一个聚合入口，筛选不改变其身份或执行范围。
 */
export type UnitCanvasNode = {
    id: string;
    title: string;
    object: CanvasObject;
    summary: Array<CanvasSummaryField>;
    edit_target: (CanvasTarget | null);
    sources: Array<CanvasTarget>;
    issues: Array<CanvasIssue>;
    home_view_id: string;
    kind: 'unit';
    unit_id: string;
    number: number;
    coverage_count: number;
    reference_count: number;
    /**
     * 仅表示覆盖形态符合当前单 coverage 执行限制，不代表整体准备通过
     */
    execution_scope_supported: boolean;
};
