/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 候选资产（asset_id 只能从这里选）。
 */
export type BindingCandidateRead = {
    asset_id: string;
    /**
     * character / scene / prop / costume
     */
    asset_type: string;
    name: string;
    aliases?: Array<string>;
    description?: string;
};

