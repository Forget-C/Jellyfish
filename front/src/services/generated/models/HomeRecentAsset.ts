/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 跨分类排序后的资产库条目。
 */
export type HomeRecentAsset = {
    id: string;
    type: 'actor' | 'scene' | 'prop' | 'costume';
    name: string;
    updated_at: string;
    thumbnail: (string | null);
};
