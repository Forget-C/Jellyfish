/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Source } from './Source';
/**
 * 一项固定输入的原字段、来源与实际纳入原因。
 */
export type UnitScopeUse_Input = {
    owner: string;
    field: string;
    text: string;
    sources: Array<Source>;
    reason: string;
    coverage_item_ids?: Array<string>;
    phase?: ('video' | 'sound' | 'postproduction' | null);
    condition?: (string | null);
};
