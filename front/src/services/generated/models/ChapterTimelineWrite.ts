/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChapterTimelineSegmentWrite } from './ChapterTimelineSegmentWrite';
/**
 * 全量替换章节时间线片段。
 */
export type ChapterTimelineWrite = {
    /**
     * 与 GET 返回一致时可校验乐观锁
     */
    layout_version?: (number | null);
    segments?: Array<ChapterTimelineSegmentWrite>;
};

