/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ModelCategoryKey } from './ModelCategoryKey';
/**
 * 系统支持的供应商能力清单。
 */
export type ProviderSupportedRead = {
    /**
     * 供应商稳定键
     */
    key: string;
    /**
     * 供应商展示名
     */
    display_name: string;
    /**
     * 可识别别名
     */
    aliases?: Array<string>;
    /**
     * 支持的模型类别
     */
    supported_categories?: Array<ModelCategoryKey>;
    /**
     * 默认 API Base URL
     */
    default_base_url?: (string | null);
    /**
     * 是否要求 api_key
     */
    requires_api_key?: boolean;
    /**
     * 是否要求 api_secret
     */
    requires_api_secret?: boolean;
    /**
     * 是否实验性供应商
     */
    is_experimental?: boolean;
};

