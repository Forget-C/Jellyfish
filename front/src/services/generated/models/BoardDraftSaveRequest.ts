/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 保存**一镜**草稿的请求（每镜生成结束后立刻调用；幂等 upsert）。
 */
export type BoardDraftSaveRequest = {
    shot_id: string;
    /**
     * ok=生成成功有正文；failed=生成失败（只记原因，正文可省略）
     */
    status?: 'ok' | 'failed';
    /**
     * 草稿正文（status=ok 时必填）
     */
    prompt?: string;
    /**
     * 失败原因（status=failed 时填）
     */
    error?: string;
    /**
     * 草稿来源，省略按 llm；只接受看板允许的来源
     */
    source?: string;
    /**
     * 本次使用的模型名（可选，便于对账）
     */
    model?: string;
    /**
     * 附加信息（latency_ms / warnings 等）
     */
    meta?: Record<string, any>;
    /**
     * 本次生成持有的租约令牌（可选；写入即释放租约）
     */
    claim_token?: string;
};

