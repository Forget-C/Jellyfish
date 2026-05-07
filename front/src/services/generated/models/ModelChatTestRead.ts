/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 模型试聊响应（仅返回正文与耗时，不回显密钥）。
 */
export type ModelChatTestRead = {
    /**
     * 模型回复正文
     */
    reply?: string;
    /**
     * 服务端调用耗时（毫秒）
     */
    elapsed_ms: number;
};

