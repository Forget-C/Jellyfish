/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 镜头间转场：从哪镜到哪镜、转场类型及可选说明。
 */
export type Transition = {
    from_shot_id: string;
    to_shot_id: string;
    transition?: 'CUT' | 'DISSOLVE' | 'WIPE' | 'FADE_IN' | 'FADE_OUT' | 'MATCH_CUT' | 'J_CUT' | 'L_CUT';
    /**
     * 为何用该转场（可选）
     */
    note?: (string | null);
};

