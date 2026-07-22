/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VideoFrameReferenceFiles } from './VideoFrameReferenceFiles';
/**
 * 视频生成任务请求。
 */
export type VideoGenerationTaskRequest = {
    /**
     * 镜头 ID
     */
    shot_id: string;
    reference_mode: 'first' | 'last' | 'key' | 'first_last' | 'first_last_key' | 'text_only';
    /**
     * 视频提示词（text_only 必填）
     */
    prompt?: (string | null);
    frame_references?: VideoFrameReferenceFiles;
    /**
     * 视频画幅比例，如 16:9 / 9:16
     */
    ratio: '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '21:9';
};

