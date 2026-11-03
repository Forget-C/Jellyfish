/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Input } from './Note_Input';
/**
 * 对白身份和版本为表演及声音策略的共同依据。
 */
export type Dialogue_Input = {
    id: string;
    participant_id: string;
    version: string;
    content: Note_Input;
};
