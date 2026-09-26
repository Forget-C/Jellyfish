/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 单条绑定建议（**仅供人工确认，本接口不写库**）。
 */
export type BindingSuggestionRead = {
    slot: 'characters' | 'scene' | 'props' | 'costumes';
    asset_id: string;
    asset_type: string;
    asset_name?: string;
    confidence?: number;
    reason?: string;
    /**
     * 与启发式/已有绑定的对账结果
     */
    agreement?: 'both' | 'llm_only' | 'conflict' | 'heuristic_only';
    /**
     * auto=默认勾选 / review=人工复核 / discard=折叠
     */
    tier?: 'auto' | 'review' | 'discard';
    /**
     * 该镜头是否已绑定此资产
     */
    already_bound?: boolean;
    /**
     * 人工确认时调用的现有写库端点（本接口不调用）
     */
    confirm_endpoint?: string;
};

