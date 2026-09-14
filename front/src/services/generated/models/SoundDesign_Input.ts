/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Dialogue_Input } from './Dialogue_Input';
import type { Note_Input } from './Note_Input';
/**
 * 声音设计与实际制作方式分开，待后期不意味着已完成。
 */
export type SoundDesign_Input = {
    dialogues: Array<Dialogue_Input>;
    sources: Note_Input;
    ambience_actions: Note_Input;
    music_constraints: Note_Input;
    execution: string;
};

