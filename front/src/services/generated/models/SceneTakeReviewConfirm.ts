/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 明确复核已保存的同一份方案，修订与素材身份共同保证幂等。
 */
export type SceneTakeReviewConfirm = {
    expected_revision: number;
    take_kind: 'production_plan' | 'scene_video';
    take_id: string;
};
