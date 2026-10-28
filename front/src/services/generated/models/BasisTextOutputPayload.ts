/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 创作依据直接输出正文与只读来源定位，定位信息不是模型指令。
 */
export type BasisTextOutputPayload = {
    kind?: 'basis';
    text: string;
    source_locator: string;
    selection_start?: (number | null);
    selection_end?: (number | null);
};

