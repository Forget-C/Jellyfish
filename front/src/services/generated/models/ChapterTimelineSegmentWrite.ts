/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 保存时间线时的一段（顺序由数组顺序表达）。
 */
export type ChapterTimelineSegmentWrite = {
    /**
     * 镜头 ID
     */
    shot_id: string;
    /**
     * 入点毫秒（可选）
     */
    trim_start_ms?: (number | null);
    /**
     * 出点毫秒（可选）
     */
    trim_end_ms?: (number | null);
};

