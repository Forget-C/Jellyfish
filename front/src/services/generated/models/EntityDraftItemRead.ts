/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 实体清单草稿项（仅预览，不建实体）。
 */
export type EntityDraftItemRead = {
    name: string;
    aliases?: Array<string>;
    entity_type: 'character' | 'scene' | 'prop';
    profile?: string;
    confidence?: number;
    /**
     * 名称/别名是否能在原文中找到
     */
    grounded?: boolean;
    /**
     * 被合并进来的原始名称
     */
    merged_from?: Array<string>;
};

