/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Output } from './Note_Output';
/**
 * 计划前后态按领域分组，实际观察不回写此处。
 */
export type ContinuityState_Output = {
    id: string;
    domain: string;
    participant_id?: (string | null);
    event_id?: (string | null);
    before: Note_Output;
    change: Note_Output;
    after: Note_Output;
    following_constraint: Note_Output;
};

