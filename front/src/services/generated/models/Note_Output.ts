/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Source } from './Source';
/**
 * 区分未知、未填写、不适用、明确无、事实和创作提议。确认由服务另记。
 */
export type Note_Output = {
    state?: 'unset' | 'unknown' | 'not_applicable' | 'none' | 'fact' | 'proposal';
    text?: (string | null);
    reason?: (string | null);
    sources?: Array<Source>;
};

