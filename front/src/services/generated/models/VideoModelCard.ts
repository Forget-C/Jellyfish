/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PromptDocument } from './PromptDocument';
import type { VideoModelConfig } from './VideoModelConfig';
/**
 * 视频处理卡；目标端口固定帧与主体用途。
 */
export type VideoModelCard = {
    id: string;
    type_version?: number;
    model_id?: (string | null);
    prompt?: PromptDocument;
    type?: string;
    config?: VideoModelConfig;
};

