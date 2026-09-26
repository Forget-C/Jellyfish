/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ImageTaskResultRead } from './ImageTaskResultRead';
/**
 * 出图提交结果。
 */
export type ImageSubmitRead = {
    project_id: string;
    asset_type: string;
    stage: string;
    results?: Array<ImageTaskResultRead>;
    summary?: Record<string, any>;
    /**
     * 本次提交的整体归一化口径（新）：ok（全部成功）/ partial_failed（有成功也有失败，或存在图片已生成但 OSS 未就绪）/ failed（全部失败）/ running（还有未完成）/ dry_run / empty
     */
    outcome?: string;
    warnings?: Array<string>;
    guard_status?: string;
    /**
     * 边界说明
     */
    note?: string;
};

