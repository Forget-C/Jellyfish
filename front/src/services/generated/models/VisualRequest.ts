/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 本次验证图的固定设计、目的和显式参考，不隐式读取全项目素材。
 */
export type VisualRequest = {
    design_revision_id: string;
    prompt: string;
    purpose: 'identity' | 'space' | 'composition' | 'continuity';
    model_id?: (string | null);
    reference_file_ids?: Array<string>;
    ratio?: '16:9' | '9:16' | '1:1';
};
