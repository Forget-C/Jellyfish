/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 释放一镜租约的请求（用户点"停止"后不生成这一镜时用）。
 */
export type BoardDraftReleaseRequest = {
    shot_id: string;
    /**
     * 持有者令牌；不匹配则拒绝释放
     */
    claim_token?: string;
    /**
     * 填了就顺带把该镜记为失败（带这个原因）
     */
    error?: string;
};

