/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Output } from './Note_Output';
/**
 * 叙事节拍保留目标、阻碍和变化，独立于镜头拆分。
 */
export type Beat_Output = {
    id: string;
    event_ids: Array<string>;
    objective: Note_Output;
    obstacle: Note_Output;
    expected_change: Note_Output;
    must_show: Note_Output;
};

