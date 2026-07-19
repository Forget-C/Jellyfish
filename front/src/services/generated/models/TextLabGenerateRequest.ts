/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TextLabMessage } from './TextLabMessage';
/**
 * 提交一轮文本实验，并指定本轮使用的已登记文本模型。
 */
export type TextLabGenerateRequest = {
    /**
     * 已登记的文本模型 ID
     */
    model_id: string;
    /**
     * 按顺序传递的会话历史
     */
    messages: Array<TextLabMessage>;
};

