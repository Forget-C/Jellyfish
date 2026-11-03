/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
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
    missing_designs?: Array<string>;
    prompt?: PromptDocument;
    input_bindings?: Array<InputBinding>;
    type?: string;
    config?: TextModelConfig;
};
