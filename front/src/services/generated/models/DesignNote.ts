/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Source } from './Source';
/**
 * 独立规则或问题的身份；历史快照没有 ID 时仍可原样读取。
 */
export type DesignNote = {
    state?: 'unset' | 'unknown' | 'not_applicable' | 'none' | 'fact' | 'proposal';
    text?: (string | null);
    reason?: (string | null);
    sources?: Array<Source>;
    id?: (string | null);
};
