/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Output } from './Note_Output';
/**
 * 镜内参与者的独立任务、触发与出入画。
 */
export type StagingActivity_Output = {
    id?: (string | null);
    participant_id: string;
    anchor_id?: (string | null);
    trigger_event_id?: (string | null);
    depth: Note_Output;
    ongoing_task: Note_Output;
    path: Note_Output;
    attention: Note_Output;
    reaction_delay: Note_Output;
    delay_ms?: (number | null);
    intensity: Note_Output;
    entrances_exits: Note_Output;
    narrative_support: Note_Output;
    end_state: Note_Output;
};
