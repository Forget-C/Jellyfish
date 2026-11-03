/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Input } from './Note_Input';
/**
 * 镜内参与者的独立任务、触发与出入画。
 */
export type StagingActivity_Input = {
    id?: (string | null);
    participant_id: string;
    anchor_id?: (string | null);
    trigger_event_id?: (string | null);
    depth: Note_Input;
    ongoing_task: Note_Input;
    path: Note_Input;
    attention: Note_Input;
    reaction_delay: Note_Input;
    delay_ms?: (number | null);
    intensity: Note_Input;
    entrances_exits: Note_Input;
    narrative_support: Note_Input;
    end_state: Note_Input;
};
