/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChapterTimelineEncodeMode } from './ChapterTimelineEncodeMode';
/**
 * 发起章节时间线导出任务。
 */
export type ChapterTimelineExportRequest = {
    /**
     * 可选幂等键
     */
    idempotency_key?: (string | null);
    /**
     * uniform_transcode：统一转码拼接；lossless_concat_only：仅当片段编码一致时无损拼接
     */
    encode_mode?: ChapterTimelineEncodeMode;
};

