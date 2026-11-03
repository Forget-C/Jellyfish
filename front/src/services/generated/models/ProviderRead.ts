/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProviderStatus } from './ProviderStatus';
/**
 * 对外返回的供应商信息（不包含 api_key/api_secret）。
 */
export type ProviderRead = {
    /**
     * 供应商名称
     */
    name: string;
    /**
     * 文本/通用 API Base URL
     */
    base_url: string;
    /**
     * 图片能力 API Base URL（可选覆盖）
     */
    image_base_url?: (string | null);
    /**
     * 视频能力 API Base URL（可选覆盖）
     */
    video_base_url?: (string | null);
    /**
     * 说明
     */
    description?: string;
    /**
     * 状态：active/testing/disabled
     */
    status?: ProviderStatus;
    /**
     * 创建人
     */
    created_by?: string;
    /**
     * 供应商 ID
     */
    id: string;
};

