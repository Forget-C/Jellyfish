/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 冻结本轮人工意见和起始版本供异步 AI 操作使用。
 */
export type AIRequest = {
    model_id?: (string | null);
    instruction?: string;
    revision_id?: (string | null);
    expected_version?: (number | null);
};

