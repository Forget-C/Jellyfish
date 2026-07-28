/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TextLabMessage } from './TextLabMessage';
/**
 * 过渡期同步文本调用请求；文本主界面将在 D3 固定切换至 SSE。
 */
export type TextLabGenerateRequest = {
    model_id: string;
    messages: Array<TextLabMessage>;
};

