/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TimelineClipStatus } from './TimelineClipStatus';
/**
 * 时间线片段读取模型（含成片文件解析状态）。
 */
export type ChapterTimelineSegmentRead = {
    /**
     * 片段行 ID；尚未落库的合成行可为空字符串
     */
    id: string;
    shot_id: string;
    position: number;
    trim_start_ms?: (number | null);
    trim_end_ms?: (number | null);
    clip_status: TimelineClipStatus;
    file_id?: (string | null);
    /**
     * 镜头标题等展示字段
     */
    label?: string;
};

