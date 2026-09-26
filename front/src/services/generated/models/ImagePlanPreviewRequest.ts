/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PromptOverride } from './PromptOverride';
/**
 * 出图提交计划预览请求（不触网）。
 */
export type ImagePlanPreviewRequest = {
    project_id: string;
    /**
     * 出图服务只支持 character/scene/prop
     */
    asset_type?: 'character' | 'scene' | 'prop' | 'costume';
    /**
     * 定妆照阶段不带垫图；垫图批量阶段带定版垫图
     */
    stage?: 'character_sheet' | 'reference_batch';
    /**
     * 为空表示项目内该类型全部资产
     */
    asset_ids?: Array<string>;
    /**
     * 用 P1 生成的提示词覆盖
     */
    prompt_overrides?: Array<PromptOverride>;
    /**
     * 垫图批量阶段是否使用定版主图做垫图
     */
    use_primary_reference?: boolean;
    /**
     * 出图比例，如 16:9
     */
    aspect_ratio?: string;
    /**
     * 图片模型选项（留空=默认 image2 → provider 模型 gpt-image-2）
     */
    image_model?: string;
    /**
     * 全局负面提示词
     */
    negative_prompt?: string;
};

