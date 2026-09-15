/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Input } from './Note_Input';
/**
 * 跨场审查固定实际末幅与入幅，并记录有意转换而非强求状态相同。
 */
export type TransitionWrite_Input = {
    left_sequence_id: string;
    right_sequence_id: string;
    left_cut_revision_id: string;
    right_cut_revision_id: string;
    left_frame_id: string;
    right_frame_id: string;
    verdict: 'pass' | 'revise';
    intent: string;
    observation: Note_Input;
    sound: Note_Input;
};
