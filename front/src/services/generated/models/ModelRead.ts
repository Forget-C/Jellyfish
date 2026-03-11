/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ModelCategoryKey } from './ModelCategoryKey';
/**
 * 对外返回的模型信息。
 */
export type ModelRead = {
    /**
     * 模型名称
     */
    name: string;
    /**
     * 模型类别：text/image/video
     */
    category: ModelCategoryKey;
    /**
     * 所属供应商 ID
     */
    provider_id: string;
    /**
     * 模型参数（JSON）
     */
    params?: Record<string, any>;
    /**
     * 说明
     */
    description?: string;
    /**
     * 是否默认
     */
    is_default?: boolean;
    /**
     * 创建人
     */
    created_by?: string;
    /**
     * 模型 ID
     */
    id: string;
};

