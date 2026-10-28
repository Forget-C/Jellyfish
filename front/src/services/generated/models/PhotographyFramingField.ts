/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 仅已知景别结构可比较；自由文字不解释为硬要求。
 */
export type PhotographyFramingField = {
    text?: string;
    state?: 'empty' | 'not_applicable' | 'absent' | 'undecided' | 'proposal' | 'fact';
    purpose?: 'background' | 'design' | 'constraint';
    source_locator?: string;
    size?: ('extreme_close_up' | 'close_up' | 'medium' | 'full' | 'wide' | 'extreme_wide' | null);
    target_id?: string;
    state_id?: (string | null);
};
