/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasIssue } from './CanvasIssue';
import type { CanvasObject } from './CanvasObject';
import type { CanvasReferencePreview } from './CanvasReferencePreview';
import type { CanvasSummaryField } from './CanvasSummaryField';
import type { CanvasTarget } from './CanvasTarget';
import type { ReferenceBinding_Output } from './ReferenceBinding_Output';
/**
 * 单元的真实输入集合或固定位置；绑定保留用途、角色、顺序及固定文件身份。
 */
export type UnitReferencesCanvasNode = {
    id: string;
    title: string;
    object: CanvasObject;
    summary: Array<CanvasSummaryField>;
    edit_target: (CanvasTarget | null);
    sources: Array<CanvasTarget>;
    issues: Array<CanvasIssue>;
    home_view_id: string;
    kind: 'unit_references';
    unit_id: string;
    input_role: 'all' | 'first_frame' | 'last_frame' | 'subject';
    subject_group_id: (string | null);
    binding_count: number;
    bindings: Array<ReferenceBinding_Output>;
    previews: Array<CanvasReferencePreview>;
};

