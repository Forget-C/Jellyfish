/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Dialogue_Output } from './Dialogue_Output';
import type { Note_Output } from './Note_Output';
/**
 * 声音设计与实际制作方式分开，待后期不意味着已完成。
 */
export type SoundDesign_Output = {
    dialogues: Array<Dialogue_Output>;
    sources: Note_Output;
    ambience_actions: Note_Output;
    music_constraints: Note_Output;
    execution: string;
};

