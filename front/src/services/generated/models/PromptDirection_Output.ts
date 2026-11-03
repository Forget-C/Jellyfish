/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Output } from './Note_Output';
/**
 * 提示词部门的编译约束；最终文本在 PromptRevision 保存。
 */
export type PromptDirection_Output = {
    priorities: Note_Output;
    binding_requirements: Note_Output;
    sound_strategy: Note_Output;
    prohibitions: Note_Output;
};
