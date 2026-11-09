/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 工作台原始字段适用声明，普通保存不据此建立关系。
 */
export type CanvasStoryboardApplicability = {
    fields: Array<string>;
    shot_ids: Array<string>;
    phase: 'all' | 'image' | 'video' | 'sound' | 'postproduction';
    condition_id?: (string | null);
    occurrence_ids: Array<string>;
};
