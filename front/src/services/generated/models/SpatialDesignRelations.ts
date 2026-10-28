/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 各空间关系用途保持独立；名称不授予读取正文的许可。
 */
export type SpatialDesignRelations = {
    space_id?: (string | null);
    participant_id?: (string | null);
    effect_object_ids?: Array<string>;
    position_anchor_ids?: Array<string>;
    area_anchor_id?: (string | null);
    change_event_id?: (string | null);
    trigger_event_id?: (string | null);
};
