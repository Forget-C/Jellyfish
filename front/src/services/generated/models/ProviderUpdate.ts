/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProviderStatus } from './ProviderStatus';
/**
 * 更新供应商时的可选字段。
 */
export type ProviderUpdate = {
    /**
     * 供应商名称
     */
    name?: (string | null);
    /**
     * 文本/通用 API Base URL
     */
    base_url?: (string | null);
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
    description?: (string | null);
    /**
     * 状态：active/testing/disabled
     */
    status?: (ProviderStatus | null);
    /**
     * API Key（敏感，不在响应中回显）
     */
    api_key?: (string | null);
    /**
     * API Secret（敏感，不在响应中回显）
     */
    api_secret?: (string | null);
};

