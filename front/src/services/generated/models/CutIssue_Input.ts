/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Input } from './Note_Input';
import type { ObservedRange } from './ObservedRange';
/**
 * 区分必须修复、可优化与后期事项，并保留证据及验收条件。
 */
export type CutIssue_Input = {
    id: string;
    severity: 'required' | 'optional' | 'postproduction';
    observation: Note_Input;
    evidence?: Array<ObservedRange>;
    acceptance: Note_Input;
};
