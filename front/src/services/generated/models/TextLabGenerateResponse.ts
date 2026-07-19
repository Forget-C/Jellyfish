/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 文本模型完成一轮调用后返回的标准结果。
 */
export type TextLabGenerateResponse = {
    /**
     * 实际调用的文本模型 ID
     */
    model_id: string;
    /**
     * 模型回复文本
     */
    content: string;
};

