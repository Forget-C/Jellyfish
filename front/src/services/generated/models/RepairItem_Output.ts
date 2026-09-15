/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MediaRange } from './MediaRange';
import type { Note_Output } from './Note_Output';
import type { ObservedRange } from './ObservedRange';
/**
 * 固定旧片段与保留范围，关联局部修法、新计划及结果比较。
 */
export type RepairItem_Output = {
    cut_revision_id: string;
    item_id: string;
    problem_range: MediaRange;
    symptom: Note_Output;
    root_cause_hypothesis: Note_Output;
    retained_ranges: Array<ObservedRange>;
    preferred_fix: 'trim' | 'replace' | 'reshoot' | 'design' | 'postproduction';
    alternative_fix: Note_Output;
    needs_new_media: boolean;
    primary_change: Note_Output;
    acceptance: Note_Output;
    result_plan_revision_id?: (string | null);
    result_unit_id?: (string | null);
    result_take_id?: (string | null);
    result_range?: (MediaRange | null);
    result_cut_revision_id?: (string | null);
    comparison?: Note_Output;
    attribution?: 'unproven' | 'single_variable' | 'multiple_variables';
};
