/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasIssue } from './CanvasIssue';
import type { CanvasObject } from './CanvasObject';
import type { CanvasSummaryField } from './CanvasSummaryField';
import type { CanvasTarget } from './CanvasTarget';
/**
 * 设计卡片保留其自身字段与范围含义，不泛化为生产配置。
 */
export type DesignCanvasNode = {
    id: string;
    title: string;
    object: CanvasObject;
    summary: Array<CanvasSummaryField>;
    edit_target: (CanvasTarget | null);
    sources: Array<CanvasTarget>;
    issues: Array<CanvasIssue>;
    home_view_id: string;
    kind: 'design';
    design_kind: 'overview' | 'space' | 'location' | 'performance' | 'staging' | 'sound' | 'prompt' | 'participant' | 'event' | 'criterion' | 'fact' | 'beat' | 'anchor' | 'blocking' | 'shot' | 'situation' | 'activity' | 'camera' | 'continuity' | 'dialogue';
    editor_kind: 'direction' | 'participants' | 'performance' | 'staging' | 'cinematography' | 'continuity' | 'sound' | 'prompt' | 'location';
    record_id: (string | null);
    number: (number | null);
    fields: Array<string>;
    scope_label: string;
    scope_reason: string;
};
