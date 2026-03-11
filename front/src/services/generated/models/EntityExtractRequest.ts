/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TextChunkInput } from './TextChunkInput';
/**
 * 实体抽取请求。
 */
export type EntityExtractRequest = {
    /**
     * 小说/章节标识，如 novel_ch01
     */
    source_id: string;
    /**
     * 语言，如 zh / en
     */
    language?: (string | null);
    /**
     * 文本块列表
     */
    chunks: Array<TextChunkInput>;
};

