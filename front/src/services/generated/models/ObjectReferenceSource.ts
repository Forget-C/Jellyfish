/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 图片实际来源身份；角度切换沿该来源，不隐式采用其他来源图片。
 */
export type ObjectReferenceSource = {
    kind: 'character' | 'actor' | 'scene' | 'prop';
    asset_id: string;
};
