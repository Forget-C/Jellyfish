/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 整卡检查只记录未纳入执行的理由，不将跳过项标作通过。
 */
export type CanvasCheckOmission = {
    item_id: string;
    label: string;
    source_card_id: string;
    status: 'disabled' | 'unavailable';
    reason: string;
};
