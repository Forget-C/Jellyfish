/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TextChunkInput } from './TextChunkInput';
/**
 * 分镜抽取请求。
 */
export type ShotlistExtractRequest = {
    /**
     * 小说/章节标识
     */
    source_id: string;
    /**
     * 书名/章节名
     */
    source_title?: (string | null);
    /**
     * 语言，如 zh / en
     */
    language?: (string | null);
    /**
     * 文本块列表
     */
    chunks: Array<TextChunkInput>;
};

