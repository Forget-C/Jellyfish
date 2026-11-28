/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ModelCapabilityProfile_Input } from './ModelCapabilityProfile_Input';
import type { ModelCategoryKey } from './ModelCategoryKey';
/**
 * 更新模型请求体（全部可选）。
 */
export type ModelUpdate = {
    /**
     * 模型名称
     */
    name?: (string | null);
    /**
     * 模型类别
     */
    category?: (ModelCategoryKey | null);
    /**
     * 所属供应商 ID
     */
    provider_id?: (string | null);
    /**
     * 模型参数（JSON）
     */
    params?: (Record<string, any> | null);
    /**
     * 说明
     */
    description?: (string | null);
    capability_profile?: (ModelCapabilityProfile_Input | null);
};
