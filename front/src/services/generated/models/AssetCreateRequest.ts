/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 仅显式录入跨场稳定设定；本场动作仍保存在设计工作单。
 */
export type AssetCreateRequest = {
    kind: 'character' | 'scene' | 'prop';
    name: string;
    description?: string;
};
