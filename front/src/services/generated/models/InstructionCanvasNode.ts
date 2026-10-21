/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasIssue } from './CanvasIssue';
import type { CanvasObject } from './CanvasObject';
import type { CanvasSummaryField } from './CanvasSummaryField';
import type { CanvasTarget } from './CanvasTarget';
import type { InstructionCanvasRecord } from './InstructionCanvasRecord';
import type { Source } from './Source';
/**
 * 完整自由文本的已保存投影；编辑目标始终指向明确生产单元。
 */
export type InstructionCanvasNode = {
    id: string;
    title: string;
    object: CanvasObject;
    summary: Array<CanvasSummaryField>;
    edit_target: (CanvasTarget | null);
    sources: Array<CanvasTarget>;
    issues: Array<CanvasIssue>;
    home_view_id: string;
    kind: 'instruction';
    unit_id: string;
    text: string;
    source: (Source | null);
    basis_id: (string | null);
    basis_status: 'empty' | 'unbound' | 'current' | 'changed' | 'unverified';
    evidence_issue: (string | null);
    records: Array<InstructionCanvasRecord>;
};
