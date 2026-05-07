/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ModelCategoryKey } from './ModelCategoryKey';
/**
 * 模型配置验证结果（同步探测；不含任何密钥明文）。
 */
export type ModelVerifyRead = {
    /**
     * 是否探测通过
     */
    ok: boolean;
    /**
     * 被验证模型的类别
     */
    category: ModelCategoryKey;
    /**
     * 面向用户的主提示
     */
    message: string;
    /**
     * 服务端探测耗时（毫秒）
     */
    elapsed_ms: number;
    /**
     * 脱敏后的诊断信息（如 provider_key、上游 HTTP 状态、回复摘要）；无 RBAC 时仍不得包含密钥
     */
    detail?: (Record<string, any> | null);
};

