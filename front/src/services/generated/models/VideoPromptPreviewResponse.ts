/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ShotVideoPromptPackRead } from './ShotVideoPromptPackRead';
import type { VideoAudioPlanRead } from './VideoAudioPlanRead';
export type VideoPromptPreviewResponse = {
    /**
     * 最终用于视频生成的提示词
     */
    prompt: string;
    /**
     * 关联参考图 file_id 列表
     */
    images?: Array<string>;
    /**
     * 视频提示词预览上下文包
     */
    pack?: (ShotVideoPromptPackRead | null);
    /**
     * 参考音频审计（只增字段）：included / file_id / url / excluded_reason —— 本次请求是否携带音频、带的是哪个地址、没带是为什么（口径与直提出视频同一份实现）
     */
    audio?: (VideoAudioPlanRead | null);
    /**
     * 参考音频相关的提示（未携带时的原因 + 修法）
     */
    audio_warnings?: Array<string>;
};

