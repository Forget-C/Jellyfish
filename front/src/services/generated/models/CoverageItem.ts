/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 单元内的一次镜头出现项，动作部分用事件 ID 明确表达。
 */
export type CoverageItem = {
    id: string;
    shot_id: string;
    beat_ids: Array<string>;
    event_ids: Array<string>;
    action_scope: string;
};

