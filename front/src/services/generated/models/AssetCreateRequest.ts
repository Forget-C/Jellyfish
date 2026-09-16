/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 同次创建固定请求身份，结果不明时重试不会重复建档；不修改本场设计。
 */
export type AssetCreateRequest = {
    request_id: string;
    kind: 'character' | 'scene' | 'prop';
    name: string;
    description?: string;
};
