/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Input } from './Note_Input';
/**
 * 叙事节拍保留目标、阻碍和变化，独立于镜头拆分。
 */
export type Beat_Input = {
    id: string;
    event_ids: Array<string>;
    objective: Note_Input;
    obstacle: Note_Input;
    expected_change: Note_Input;
    must_show: Note_Input;
};

