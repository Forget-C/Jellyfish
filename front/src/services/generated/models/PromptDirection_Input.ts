/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Input } from './Note_Input';
/**
 * 提示词部门的编译约束；最终文本在 PromptRevision 保存。
 */
export type PromptDirection_Input = {
    priorities: Note_Input;
    binding_requirements: Note_Input;
    sound_strategy: Note_Input;
    prohibitions: Note_Input;
};

