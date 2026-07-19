/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 实验会话中的一条文本消息。
 */
export type TextLabMessage = {
    /**
     * 消息角色
     */
    role: 'system' | 'user' | 'assistant';
    /**
     * 消息内容
     */
    content: string;
};

