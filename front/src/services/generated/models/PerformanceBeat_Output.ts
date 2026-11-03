/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Output } from './Note_Output';
/**
 * 节拍与人物共同确定一行表演，保留刺激到可见行动的因果。
 */
export type PerformanceBeat_Output = {
    id?: (string | null);
    beat_id: string;
    participant_id: string;
    received_event_ids: Array<string>;
    objective: Note_Output;
    obstacle: Note_Output;
    subtext: Note_Output;
    attention: Note_Output;
    internal_adjustment: Note_Output;
    physical_action: Note_Output;
    dialogue_ids: Array<string>;
    delivery: Note_Output;
    reaction_order: Note_Output;
    exit_state: Note_Output;
    avoid: Note_Output;
    criterion_ids: Array<string>;
    gaze?: Note_Output;
    breath?: Note_Output;
    weight?: Note_Output;
    hands?: Note_Output;
    voice?: Note_Output;
};
