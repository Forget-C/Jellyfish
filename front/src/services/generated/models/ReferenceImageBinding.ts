/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { OutputIdentity } from './OutputIdentity';
/**
 * 固定具体文件及直接来源产物；无画布来源即项目文件选择。
 */
export type ReferenceImageBinding = {
    file_id: string;
    source?: (OutputIdentity | null);
    result_set_id?: (string | null);
};
