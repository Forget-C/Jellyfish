/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TextChunkInput } from './TextChunkInput';
/**
 * 实体抽取任务请求：创建任务并绑定到 project/chapter/shot。
 */
export type EntityExtractTaskRequest = {
    /**
     * 绑定项目 ID（可选）
     */
    project_id?: (string | null);
    /**
     * 绑定章节 ID（可选）
     */
    chapter_id?: (string | null);
    /**
     * 绑定镜头 ID（可选）
     */
    shot_id?: (string | null);
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

