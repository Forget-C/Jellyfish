/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 预演项只引用设计和预计时长，没有伪造媒体区间。
 */
export type PlannedCutItem = {
    kind: string;
    id: string;
    design_revision_id: string;
    shot_id: string;
    estimated_duration_ms: number;
    timeline_start_ms: number;
};

