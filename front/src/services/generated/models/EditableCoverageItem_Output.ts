/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 单元的镜头出现项允许尚未填写动作范围；已有节拍与事件须属于该镜头。
 */
export type EditableCoverageItem_Output = {
    id: string;
    shot_id: string;
    beat_ids: Array<string>;
    event_ids: Array<string>;
    action_scope: string;
};
