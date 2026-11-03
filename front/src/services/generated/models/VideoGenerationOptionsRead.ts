/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 当前默认视频模型对应的生成参数选项。
 */
export type VideoGenerationOptionsRead = {
    /**
     * 供应商稳定键
     */
    provider: string;
    /**
     * 默认视频模型 ID
     */
    model_id: string;
    /**
     * 默认视频模型名称
     */
    model_name: string;
    /**
     * 当前模型允许的比例选项
     */
    allowed_ratios?: Array<string>;
    /**
     * 当前模型默认比例
     */
    default_ratio: string;
    /**
     * 是否支持参考主体图片
     */
    supports_subject_image_reference?: boolean;
    /**
     * 是否支持参考主体视频
     */
    supports_subject_video_reference?: boolean;
    /**
     * 是否允许主体参考与首帧/尾帧/关键帧同时提交
     */
    supports_subject_reference_with_frame_reference?: boolean;
    /**
     * 主体数量上限
     */
    max_subjects?: (number | null);
    /**
     * 单主体图片上限
     */
    max_images_per_subject?: (number | null);
    /**
     * 单主体视频上限
     */
    max_videos_per_subject?: (number | null);
    /**
     * 单主体图片与视频共享槽位上限
     */
    max_media_per_subject?: (number | null);
    /**
     * 所有主体视频总数上限
     */
    max_total_subject_videos?: (number | null);
};

