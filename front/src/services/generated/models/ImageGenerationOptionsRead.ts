/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 当前默认图片模型对应的关键帧规格选项。
 */
export type ImageGenerationOptionsRead = {
    /**
     * 供应商稳定键
     */
    provider: string;
    /**
     * 默认图片模型 ID
     */
    model_id: string;
    /**
     * 默认图片模型名称
     */
    model_name: string;
    /**
     * 当前模型支持的目标比例
     */
    supported_ratios?: Array<string>;
    /**
     * 当前模型默认分辨率档位
     */
    default_resolution_profile: string;
    /**
     * 按比例和分辨率档位映射得到的像素尺寸
     */
    ratio_size_profiles?: Record<string, Record<string, string>>;
};

