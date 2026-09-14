/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { FileUsageWrite } from './FileUsageWrite';
/**
 * 仅允许修改显示名称、标签与使用位置，禁止替换文件内容或对象地址。
 */
export type FileUpdate = {
    name?: (string | null);
    tags?: (Array<string> | null);
    /**
     * 若提供则 upsert 一条 file_usages
     */
    usage?: (FileUsageWrite | null);
};

