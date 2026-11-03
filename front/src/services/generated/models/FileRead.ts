/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { FileTypeEnum } from './FileTypeEnum';
/**
 * 文件身份保持稳定，缩略图地址在读时生成，不持久化重复 URL。
 */
export type FileRead = {
    /**
     * 文件 ID
     */
    id: string;
    /**
     * 文件类型
     */
    type: FileTypeEnum;
    /**
     * 文件名/标题
     */
    name: string;
    /**
     * 缩略图 URL/路径
     */
    thumbnail?: string;
    /**
     * 标签
     */
    tags?: Array<string>;
    deleted?: boolean;
};
