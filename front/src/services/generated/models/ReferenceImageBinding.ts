/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { OutputIdentity } from './OutputIdentity';
/**
 * 固定具体文件；新增来源仅支持图片内容卡，旧的直接文件与历史产物绑定仍保留。
 */
export type ReferenceImageBinding = {
    file_id: string;
    source?: (OutputIdentity | null);
    result_set_id?: (string | null);
};
