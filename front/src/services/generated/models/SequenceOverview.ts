/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 整场版本与素材计数，不表示选定计划的准备度或实际覆盖。
 */
export type SequenceOverview = {
    id: string;
    position: number;
    title: string;
    source_excerpt: string;
    source_changed: boolean;
    design_count: number;
    confirmed_design_count: number;
    plan_count: number;
    confirmed_plan_count: number;
    take_count: number;
    unreviewed_take_count: number;
    active_cut_revision_id: (string | null);
};
