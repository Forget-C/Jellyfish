/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChapterTimelineSegmentRead } from './ChapterTimelineSegmentRead';
/**
 * 章节时间线读取模型。
 */
export type ChapterTimelineRead = {
    layout_version?: number;
    segments?: Array<ChapterTimelineSegmentRead>;
    /**
     * 连续预览能力说明
     */
    preview_note?: string;
};

