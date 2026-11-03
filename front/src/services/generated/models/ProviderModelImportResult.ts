/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ModelRead } from './ModelRead';
import type { ProviderModelCandidate } from './ProviderModelCandidate';
/**
 * 模型批量导入结果，重复项不会重复创建。
 */
export type ProviderModelImportResult = {
    /**
     * 新创建的模型
     */
    created?: Array<ModelRead>;
    /**
     * 已存在而跳过的模型
     */
    skipped?: Array<ProviderModelCandidate>;
};

