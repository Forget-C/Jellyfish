/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Input } from './Note_Input';
/**
 * 表演前提按人物共享，不在每镜复制。
 */
export type CharacterSituation_Input = {
    id?: (string | null);
    participant_id: string;
    situation: Note_Input;
    relationship: Note_Input;
};
