/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { OutputIdentity } from './OutputIdentity';
/**
 * 按采用来源及字段定位的稳定检查项目。
 */
export type CanvasCheckItem = {
    id: string;
    category: string;
    label: string;
    source: OutputIdentity;
    field_id: string;
    requirement: string;
    enabled: boolean;
    availability?: 'ready' | 'unavailable';
    reason?: (string | null);
    scope_note?: (string | null);
    scope_editable?: boolean;
};
