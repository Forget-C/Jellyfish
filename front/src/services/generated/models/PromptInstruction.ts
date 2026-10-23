/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PromptReference } from './PromptReference';
/**
 * 本地显式系统指令；视频用途的具体映射由视频编译器消费。
 */
export type PromptInstruction = {
    id: string;
    kind: 'instruction';
    command: string;
    parameters?: Record<string, any>;
    references?: Array<PromptReference>;
};

