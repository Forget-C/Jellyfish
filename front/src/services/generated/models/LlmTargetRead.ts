/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 本次调用使用的文本模型目标（**不含 api_key**）。
 */
export type LlmTargetRead = {
    /**
     * 供应商 ID
     */
    provider_id?: string;
    /**
     * 供应商名称
     */
    provider_name?: string;
    /**
     * 模型 ID
     */
    model_id?: string;
    /**
     * 模型名称
     */
    model_name?: string;
    /**
     * Base URL
     */
    base_url?: string;
    /**
     * 超时（秒）
     */
    timeout_seconds?: number;
    /**
     * 是否已配置 api_key（不返回内容）
     */
    api_key_configured?: boolean;
};

