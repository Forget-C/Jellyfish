/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PromptCategory } from './PromptCategory';
/**
 * 提示词类别选项（枚举值 + 中文标签 + 简介）。
 */
export type PromptCategoryOptionRead = {
    /**
     * 类别枚举值
     */
    value: PromptCategory;
    /**
     * 中文名称
     */
    label: string;
    /**
     * 类别简介
     */
    description?: string;
};

