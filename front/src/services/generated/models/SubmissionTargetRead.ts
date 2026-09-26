/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 一个待提交给出图服务的单资产单图任务（预览用）。
 */
export type SubmissionTargetRead = {
    /**
     * 幂等键；同资产同提示词重复提交不会重复出图
     */
    source_task_id: string;
    source_asset_id: string;
    asset_type: string;
    name?: string;
    prompt?: string;
    stage?: string;
    negative_prompt?: string;
    style_tags?: Array<string>;
    /**
     * 垫图地址（定版主图）
     */
    reference_image?: string;
    generation_type?: string;
    aspect_ratio?: string;
    image_model?: string;
    object_key_template?: string;
    /**
     * 提示词来源：request（调用方显式传）/ saved（已保存的 image_prompts）/ template（确定性模板）
     */
    prompt_source?: string;
    warnings?: Array<string>;
};

