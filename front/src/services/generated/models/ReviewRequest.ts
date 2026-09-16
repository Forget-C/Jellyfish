/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 检查请求身份在当前场次内固定；重试不创建第二次模型检查。
 */
export type ReviewRequest = {
    model_id?: (string | null);
    style_revision_id?: (string | null);
    instruction?: string;
    revision_id?: (string | null);
    expected_version?: (number | null);
    request_id?: (string | null);
};
