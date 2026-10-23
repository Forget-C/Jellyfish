/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TextModelConfig } from './TextModelConfig';
/**
 * 纯文本模型，不虚报多模态理解能力。
 */
export type TextModelCard = {
    id: string;
    type_version?: number;
    model_id?: (string | null);
    prompt?: string;
    type?: string;
    config?: TextModelConfig;
};
