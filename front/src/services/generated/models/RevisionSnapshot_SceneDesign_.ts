/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneDesign_Output } from './SceneDesign_Output';
export type RevisionSnapshot_SceneDesign_ = {
    id: string;
    project_id: string;
    chapter_id: string;
    sequence_id: string;
    parent_id: (string | null);
    version: number;
    /**
     * 指令在固定计划与单元内的稳定编号；其他版本不使用
     */
    display_number?: (number | null);
    confirmed_by: (string | null);
    confirmed_at: (string | null);
    source_current?: boolean;
    content: SceneDesign_Output;
};

