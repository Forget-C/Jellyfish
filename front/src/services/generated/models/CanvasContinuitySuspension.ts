/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DesignMediaUse } from './DesignMediaUse';
import type { InputBinding } from './InputBinding';
import type { PromptInstruction } from './PromptInstruction';
import type { PromptReference } from './PromptReference';
/**
 * 确认改用首帧时暂停的原始采用和结构化正文，按原顺序位置保留。
 */
export type CanvasContinuitySuspension = {
    model_id: string;
    input_bindings?: Record<string, InputBinding>;
    design_media_uses?: Record<string, DesignMediaUse>;
    prompt_segments?: Record<string, (PromptReference | PromptInstruction)>;
    prompt_order?: Array<string>;
};
