/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssetBindingShotRead } from './AssetBindingShotRead';
import type { BindingCandidateRead } from './BindingCandidateRead';
import type { BindingDroppedRead } from './BindingDroppedRead';
import type { BindingUnmatchedRead } from './BindingUnmatchedRead';
import type { LlmRunMeta } from './LlmRunMeta';
/**
 * P2 资产绑定预览结果。
 */
export type AssetBindingPreviewRead = {
    project_id: string;
    catalog?: Array<BindingCandidateRead>;
    shots?: Array<AssetBindingShotRead>;
    dropped?: Array<BindingDroppedRead>;
    unmatched_names?: Array<BindingUnmatchedRead>;
    parse_warnings?: Array<string>;
    batch_count?: number;
    batch_size?: number;
    /**
     * auto/review/discard 计数
     */
    tier_summary?: Record<string, number>;
    /**
     * 按批次的失败明细（不中断其他批次）
     */
    errors?: Array<string>;
    cost_note?: string;
    meta: LlmRunMeta;
    /**
     * 边界说明
     */
    note?: string;
};

