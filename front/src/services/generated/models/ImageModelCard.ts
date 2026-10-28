/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ImageFrameTarget } from './ImageFrameTarget';
import type { ImageModelConfig } from './ImageModelConfig';
import type { InputBinding } from './InputBinding';
import type { PromptDocument } from './PromptDocument';
/**
 * 图片处理卡，参考图片必须被接收端明确使用。
 */
export type ImageModelCard = {
    id: string;
    type_version?: number;
    model_id?: (string | null);
    prompt?: PromptDocument;
    input_bindings?: Array<InputBinding>;
    type?: string;
    config?: ImageModelConfig;
    frame_targets?: Array<ImageFrameTarget>;
};

