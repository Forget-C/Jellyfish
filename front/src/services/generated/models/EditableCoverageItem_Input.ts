/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 单元出现项明确选择本次执行内容；镜头关系只提供候选。
 */
export type EditableCoverageItem_Input = {
    id: string;
    shot_id: string;
    beat_ids?: Array<string>;
    event_ids?: Array<string>;
    staging_activity_ids?: Array<string>;
    performance_action_ids?: Array<string>;
    continuity_change_ids?: Array<string>;
    action_scope?: string;
};
