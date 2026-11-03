/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Input } from './Note_Input';
/**
 * 计划前后态按领域分组，实际观察不回写此处。
 */
export type ContinuityState_Input = {
    id: string;
    domain: string;
    participant_id?: (string | null);
    event_id?: (string | null);
    before: Note_Input;
    change: Note_Input;
    after: Note_Input;
    following_constraint: Note_Input;
};

