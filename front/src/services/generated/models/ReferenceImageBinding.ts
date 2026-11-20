/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { OutputIdentity } from './OutputIdentity';
/**
 * 固定具体文件。绑定来源使用图片内容卡；明确解除来源后仍可保留固定文件。
 */
export type ReferenceImageBinding = {
    file_id: string;
    source?: (OutputIdentity | null);
    result_set_id?: (string | null);
};
