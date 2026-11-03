/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 构图的结构化景别；跨卡画面定位另由显式关系表达。
 */
export type CompositionFramingField = {
    text?: string;
    state?: 'empty' | 'not_applicable' | 'absent' | 'undecided' | 'proposal' | 'fact';
    purpose?: 'background' | 'design' | 'constraint';
    source_locator?: string;
    size?: ('extreme_close_up' | 'close_up' | 'medium' | 'full' | 'wide' | 'extreme_wide' | null);
    target_id?: string;
    state_id?: (string | null);
};
