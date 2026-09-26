/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 单镜草稿请求（页面逐镜调用，可真正停止）。
 */
export type BoardDraftRequest = {
    shot_id: string;
    mode?: 'fill_empty' | 'overwrite_selected';
    /**
     * 「生成中」租约令牌：页面先调 /drafts/claim 占位时把它带回来，服务端据此认出是自己的租约并直接续租；不带也可以（服务端会自己抢一次）
     */
    claim_token?: string;
};

