/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Input } from './Note_Input';
/**
 * 人物调度状态以及状态改变的事件原因。
 */
export type BlockingState_Input = {
    id: string;
    participant_id: string;
    anchor_ids: Array<string>;
    event_id?: (string | null);
    position: Note_Input;
    orientation: Note_Input;
    initiative: Note_Input;
    path: Note_Input;
    transition_reason: Note_Input;
};

