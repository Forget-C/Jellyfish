/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BindingSuggestionRead } from './BindingSuggestionRead';
/**
 * 单个镜头的绑定预览。
 */
export type AssetBindingShotRead = {
    shot_id: string;
    index?: number;
    title?: string;
    script_excerpt?: string;
    suggestions?: Array<BindingSuggestionRead>;
    /**
     * 启发式第二意见
     */
    heuristic_suggestions?: Record<string, Array<string>>;
    /**
     * 当前已绑定的资产 ID
     */
    bound?: Record<string, Array<string>>;
    warnings?: Array<string>;
};

