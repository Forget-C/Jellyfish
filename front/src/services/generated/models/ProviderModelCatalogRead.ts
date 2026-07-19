/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProviderModelCandidate } from './ProviderModelCandidate';
/**
 * 指定 Provider 刷新到的可导入模型目录。
 */
export type ProviderModelCatalogRead = {
    /**
     * 数据库中的供应商 ID
     */
    provider_id: string;
    /**
     * 供应商稳定键
     */
    provider_key: string;
    /**
     * 模型列表来源
     */
    source: 'provider_api' | 'provider_catalog';
    /**
     * 可选择导入的模型
     */
    models?: Array<ProviderModelCandidate>;
};

