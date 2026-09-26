/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 出图服务对接状态。
 */
export type ImageServiceStatusRead = {
    base_url: string;
    configured_env: string;
    guard: Record<string, any>;
    service_asset_types: Array<string>;
    generation_types: Record<string, string>;
    /**
     * 真实健康探测结果；DRY_RUN 下为 null
     */
    probe?: (Record<string, any> | null);
    /**
     * 未探测的原因
     */
    probe_skipped_reason?: string;
};

