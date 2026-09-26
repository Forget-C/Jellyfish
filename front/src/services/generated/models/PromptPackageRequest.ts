/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 提示词包导出请求（只读，不落库、不出图）。
 */
export type PromptPackageRequest = {
    project_id: string;
    /**
     * 为空表示项目内全部镜头（上限见 max_shots）
     */
    shot_ids?: Array<string>;
    max_shots?: number;
    include_image_prompts?: boolean;
    include_video_prompts?: boolean;
    include_bindings?: boolean;
    /**
     * 同时返回 json；text/markdown 为附带的渲染结果
     */
    format?: 'json' | 'text' | 'markdown';
};

