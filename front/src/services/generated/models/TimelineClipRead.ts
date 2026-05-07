/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TimelineClipType } from './TimelineClipType';
/**
 * 时间线片段只读模型。
 */
export type TimelineClipRead = {
    /**
     * 片段 ID
     */
    id: string;
    /**
     * 片段类型：video / audio
     */
    type: TimelineClipType;
    /**
     * 来源素材 ID（逻辑引用）
     */
    source_id: string;
    /**
     * 轨道展示标签
     */
    label: string;
    /**
     * 起始时间（秒）
     */
    start: number;
    /**
     * 结束时间（秒）
     */
    end: number;
    /**
     * 轨道号
     */
    track: number;
};

