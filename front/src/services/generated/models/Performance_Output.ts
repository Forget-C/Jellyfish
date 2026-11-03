/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CharacterSituation_Output } from './CharacterSituation_Output';
import type { Note_Output } from './Note_Output';
import type { PerformanceBeat_Output } from './PerformanceBeat_Output';
/**
 * 表演部门的角色情境和节拍谱。
 */
export type Performance_Output = {
    situations: Array<CharacterSituation_Output>;
    beats: Array<PerformanceBeat_Output>;
    applicability: Note_Output;
};
