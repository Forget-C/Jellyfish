/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 问题序号仅在该不可变来源内有效，-1 表示无 findings 的整行。
 */
export type ReviewDirection = {
    occurrence_id: string;
    role: 'direction' | 'performance' | 'staging' | 'cinematography' | 'continuity' | 'prompt';
    finding_index: number;
    text: string;
    sound_execution?: ('generated' | 'postproduction' | null);
};
