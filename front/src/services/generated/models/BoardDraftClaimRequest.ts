/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 抢占一镜「生成中」租约的请求。
 */
export type BoardDraftClaimRequest = {
    shot_id: string;
    /**
     * 租约时长（秒）；省略用默认值，服务端会夹到安全区间
     */
    lease_seconds?: (number | null);
    /**
     * 同一令牌再次调用 = 续租
     */
    claim_token?: string;
};

