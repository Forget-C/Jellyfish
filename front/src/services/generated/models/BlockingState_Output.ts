/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Output } from './Note_Output';
/**
 * 人物调度状态以及状态改变的事件原因。
 */
export type BlockingState_Output = {
    id: string;
    participant_id: string;
    anchor_ids: Array<string>;
    event_id?: (string | null);
    position: Note_Output;
    orientation: Note_Output;
    initiative: Note_Output;
    path: Note_Output;
    transition_reason: Note_Output;
};

