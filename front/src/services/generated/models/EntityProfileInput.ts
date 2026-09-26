/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 调用方传入的实体画像（画像卡输入）。
 */
export type EntityProfileInput = {
    /**
     * 实体名称
     */
    name: string;
    /**
     * 实体类型
     */
    entity_type?: string;
    /**
     * 实体画像描述
     */
    profile?: string;
    /**
     * 已有资产基础提示词（可空）
     */
    base_prompt?: string;
    /**
     * 已有资产图片提示词（可空）
     */
    image_prompt?: string;
};

