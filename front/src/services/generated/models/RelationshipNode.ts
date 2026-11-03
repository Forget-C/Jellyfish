/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 对象的来源路径；历史无 ID 行仅以路径定位，不赋予持久身份。
 */
export type RelationshipNode = {
    key: string;
    kind: string;
    path: Array<(string | number)>;
    stable?: boolean;
    missing?: boolean;
    placement?: 'scene_background' | 'scene_rule' | 'shots' | 'occurrences' | 'pending_shot' | 'unlinked';
    shot_ids?: Array<string>;
    reason?: string;
};
