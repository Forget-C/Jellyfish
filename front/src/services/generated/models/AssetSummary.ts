/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 场次可复用的项目资产身份，不复制本场调度状态到资产。
 */
export type AssetSummary = {
    id: string;
    kind: 'character' | 'scene' | 'prop';
    name: string;
    description: string;
    image_file_ids?: Array<string>;
    unavailable_image_count?: number;
};
