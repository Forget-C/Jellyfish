/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasDetachedResult } from './CanvasDetachedResult';
import type { InputBinding } from './InputBinding';
import type { PromptDocument } from './PromptDocument';
import type { TextModelConfig } from './TextModelConfig';
/**
 * 纯文本模型，不虚报多模态理解能力。
 */
export type TextModelCard = {
    id: string;
    type_version?: number;
    model_id?: (string | null);
    /**
     * 在画布展开正式结果，仅控制显示
     */
    show_result_cards?: boolean;
    detached_results?: Array<CanvasDetachedResult>;
    prompt?: PromptDocument;
    input_bindings?: Array<InputBinding>;
    type?: string;
    config?: TextModelConfig;
};
