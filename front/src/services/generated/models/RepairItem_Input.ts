/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MediaRange } from './MediaRange';
import type { Note_Input } from './Note_Input';
import type { ObservedRange } from './ObservedRange';
/**
 * 固定旧片段与保留范围，关联局部修法、新计划及结果比较。
 */
export type RepairItem_Input = {
    cut_revision_id: string;
    item_id: string;
    problem_range: MediaRange;
    symptom: Note_Input;
    root_cause_hypothesis: Note_Input;
    retained_ranges: Array<ObservedRange>;
    preferred_fix: 'trim' | 'replace' | 'reshoot' | 'design' | 'postproduction';
    alternative_fix: Note_Input;
    needs_new_media: boolean;
    primary_change: Note_Input;
    acceptance: Note_Input;
    result_plan_revision_id?: (string | null);
    result_unit_id?: (string | null);
    result_take_id?: (string | null);
    result_range?: (MediaRange | null);
    result_cut_revision_id?: (string | null);
    comparison?: Note_Input;
    attribution?: 'unproven' | 'single_variable' | 'multiple_variables';
};
