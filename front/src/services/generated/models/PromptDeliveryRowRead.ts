/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 一行镜头在交付清单里的状态。
 */
export type PromptDeliveryRowRead = {
    /**
     * 镜头 ID
     */
    shot_id: string;
    /**
     * 章节 ID
     */
    chapter_id: string;
    /**
     * 章节显示标签（迁移后的章节 id 带剧本前缀，这里取 :: 之后）
     */
    chapter_label: string;
    /**
     * 镜头编号 S%03d（集内顺序）
     */
    shot_code: string;
    /**
     * 镜头标题
     */
    shot_title: string;
    /**
     * 视频提示词正文
     */
    video_prompt: string;
    /**
     * 提示词来源标记
     */
    video_prompt_source: string;
    /**
     * 是否可进入「仅提示词」出口（来源在白名单内且有正文）
     */
    exportable: boolean;
    /**
     * 不可交付时的原因
     */
    issue?: string;
    /**
     * 已绑定资产名称（characters/scene/props/costumes）
     */
    bound_assets?: Record<string, Array<string>>;
    /**
     * 绑定资产实际使用的文件（定版优先）：file_id / url / is_primary / resolved_from
     */
    bound_files?: Array<Record<string, any>>;
};

