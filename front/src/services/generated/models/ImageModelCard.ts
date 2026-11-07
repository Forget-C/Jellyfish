/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasDetachedResult } from './CanvasDetachedResult';
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
    /**
     * 在画布展开正式结果，仅控制显示
     */
    show_result_cards?: boolean;
    detached_results?: Array<CanvasDetachedResult>;
    /**
     * 已移除设计的稳定身份，补充或明确处理前阻塞运行
     */
    missing_designs?: Array<string>;
    prompt?: PromptDocument;
    input_bindings?: Array<InputBinding>;
    type?: string;
    config?: ImageModelConfig;
    frame_targets?: Array<ImageFrameTarget>;
};
