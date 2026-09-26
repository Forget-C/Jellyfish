/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 写入结果。
 */
export type JuriluApplyRead = {
    project_id: string;
    chapter_id: string;
    updated: number;
    created: number;
    written: number;
    touched_shot_ids: Array<string>;
    counts: Record<string, number>;
    plan_summary: string;
};

