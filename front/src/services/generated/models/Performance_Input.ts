/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CharacterSituation_Input } from './CharacterSituation_Input';
import type { Note_Input } from './Note_Input';
import type { PerformanceBeat_Input } from './PerformanceBeat_Input';
/**
 * 表演部门的角色情境和节拍谱。
 */
export type Performance_Input = {
    situations: Array<CharacterSituation_Input>;
    beats: Array<PerformanceBeat_Input>;
    applicability: Note_Input;
};
