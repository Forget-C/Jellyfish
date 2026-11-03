/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { InputBinding } from './InputBinding';
import type { PromptDocument } from './PromptDocument';
import type { VideoModelConfig } from './VideoModelConfig';
/**
 * 视频处理卡；目标端口固定帧与主体用途。
 */
export type VideoModelCard = {
    id: string;
    type_version?: number;
    model_id?: (string | null);
    /**
     * 已移除设计的稳定身份，补充或明确处理前阻塞运行
     */
    missing_designs?: Array<string>;
    prompt?: PromptDocument;
    input_bindings?: Array<InputBinding>;
    type?: string;
    config?: VideoModelConfig;
};
