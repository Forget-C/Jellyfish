/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 图片 operation 的可执行参数，不承载媒体 URL 或业务目标。
 */
export type ImageGenerationOperationInput = {
    kind?: string;
    target_ratio?: (string | null);
    resolution_profile?: (string | null);
    count?: number;
    size?: (string | null);
    seed?: (number | null);
    watermark?: (boolean | null);
    /**
     * 资产图仅保存候选结果，不自动替换槽位
     */
    save_as_candidate?: boolean;
};
