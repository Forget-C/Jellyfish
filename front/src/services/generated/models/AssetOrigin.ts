/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 选择图片时的项目资产身份及名称；固定后仅用于追溯。
 */
export type AssetOrigin = {
    kind: 'character' | 'scene' | 'prop';
    id: string;
    name: string;
};
