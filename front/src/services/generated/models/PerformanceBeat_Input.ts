/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Input } from './Note_Input';
/**
 * 节拍与人物共同确定一行表演，保留刺激到可见行动的因果。
 */
export type PerformanceBeat_Input = {
    id?: (string | null);
    beat_id: string;
    participant_id: string;
    received_event_ids: Array<string>;
    objective: Note_Input;
    obstacle: Note_Input;
    subtext: Note_Input;
    attention: Note_Input;
    internal_adjustment: Note_Input;
    physical_action: Note_Input;
    dialogue_ids: Array<string>;
    delivery: Note_Input;
    reaction_order: Note_Input;
    exit_state: Note_Input;
    avoid: Note_Input;
    criterion_ids: Array<string>;
    gaze?: Note_Input;
    breath?: Note_Input;
    weight?: Note_Input;
    hands?: Note_Input;
    voice?: Note_Input;
};

