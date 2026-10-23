/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 单卡或按实际引用运行到目标；默认保持单卡行为。
 */
export type CanvasPrecheckRequest = {
    card_id: string;
    kind?: 'single' | 'target';
};
