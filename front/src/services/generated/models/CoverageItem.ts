/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 单元内一次镜头出现项的明确执行选择，不从镜头关系自动推定。
 */
export type CoverageItem = {
    id: string;
    shot_id: string;
    beat_ids: Array<string>;
    event_ids: Array<string>;
    staging_activity_ids?: Array<string>;
    performance_action_ids?: Array<string>;
    continuity_change_ids?: Array<string>;
    action_scope: string;
};
