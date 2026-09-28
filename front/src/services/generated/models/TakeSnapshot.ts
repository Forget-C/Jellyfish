/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TakeAnnotation_Output } from './TakeAnnotation_Output';
/**
 * Take 的不可变身份和可更新审片注释分开表达。
 */
export type TakeSnapshot = {
    id: string;
    project_id: string;
    chapter_id: string;
    sequence_id: string;
    prompt_revision_id: string;
    plan_revision_id: string;
    unit_id: string;
    task_id: string;
    output_ordinal: number;
    file_id: string;
    version: number;
    /**
     * 候选在固定计划与单元内的稳定编号
     */
    display_number?: (number | null);
    annotation: TakeAnnotation_Output;
};

