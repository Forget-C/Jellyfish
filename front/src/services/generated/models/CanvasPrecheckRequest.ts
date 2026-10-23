/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 单卡、运行到目标或严格框选；框选 ID 中的内容卡与分组不执行。
 */
export type CanvasPrecheckRequest = {
    card_id: string;
    kind?: 'single' | 'target' | 'selection';
    card_ids?: Array<string>;
};
