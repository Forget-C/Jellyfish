/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PromptCategory } from './PromptCategory';
/**
 * 创建提示词模板。id 由后端自动生成；is_system 不可由客户端设置。
 */
export type PromptTemplateCreate = {
    /**
     * 模板类别
     */
    category: PromptCategory;
    /**
     * 模板名称
     */
    name: string;
    /**
     * 模板内容
     */
    content: string;
    /**
     * 预览文案
     */
    preview?: string;
    /**
     * 变量名列表
     */
    variables?: Array<string>;
    /**
     * 可配置变量的默认值
     */
    variable_defaults?: Record<string, string>;
    /**
     * 是否为默认提示词
     */
    is_default?: boolean;
};

