/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 镜头视频渲染允许编辑的提示词、模板与参考帧。
 */
export type ShotVideoPromptRenderBody = {
    reference_mode: 'first' | 'last' | 'key' | 'first_last' | 'first_last_key' | 'text_only';
    prompt?: (string | null);
    image_file_ids?: Array<string>;
    template_id?: (string | null);
};

