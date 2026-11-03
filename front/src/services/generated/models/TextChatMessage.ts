/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 单轮文本聊天的有序消息；不以空 prompt 伪造聊天上下文。
 */
export type TextChatMessage = {
    role: 'system' | 'user' | 'assistant';
    content: string;
    sequence: number;
};

