/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PromptInstruction } from './PromptInstruction';
import type { PromptReference } from './PromptReference';
import type { PromptText } from './PromptText';
/**
 * 编辑器无关的原文、稳定引用与指令；不存正文偏移。
 */
export type PromptDocument = {
    segments?: Array<(PromptText | PromptReference | PromptInstruction)>;
};
