/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ReferenceImageRead } from './ReferenceImageRead';
/**
 * 单个镜头的提示词包条目。
 */
export type PromptPackageShotRead = {
    shot_id: string;
    index?: number;
    title?: string;
    script_excerpt?: string;
    /**
     * 已绑定资产（按槽位）
     */
    bound_assets?: Record<string, Array<string>>;
    /**
     * 逐槽位图片提示词
     */
    image_prompts?: Array<Record<string, any>>;
    /**
     * 视频提示词（含首尾帧与运镜）
     */
    video_prompt?: (Record<string, any> | null);
    /**
     * 可作参考图的定版资产
     */
    references?: Array<ReferenceImageRead>;
    warnings?: Array<string>;
};

