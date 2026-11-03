/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Output } from './Note_Output';
/**
 * 对白身份和版本为表演及声音策略的共同依据。
 */
export type Dialogue_Output = {
    id: string;
    participant_id: string;
    version: string;
    content: Note_Output;
};
