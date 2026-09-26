/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PromptCategory } from './PromptCategory';
/**
 * 单个槽位的图片提示词。
 */
export type ImagePromptSlotRead = {
    category: PromptCategory;
    label?: string;
    entity_name?: (string | null);
    /**
     * 分层结构：主体/动作/环境/镜头/风格/画质
     */
    layers?: Record<string, string>;
    /**
     * 拼接后的完整提示词
     */
    prompt?: string;
    /**
     * 该槽位的负面提示词
     */
    negative_prompt?: string;
    warnings?: Array<string>;
};

