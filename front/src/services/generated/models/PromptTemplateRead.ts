/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PromptCategory } from './PromptCategory';
/**
 * 读取提示词模板（含全部字段）。
 */
export type PromptTemplateRead = {
    /**
     * 模板 ID
     */
    id: string;
    /**
     * 模板类别
     */
    category: PromptCategory;
    /**
     * 模板名称
     */
    name: string;
    /**
     * 预览文案
     */
    preview: string;
    /**
     * 模板内容
     */
    content: string;
    /**
     * 变量名列表
     */
    variables: Array<string>;
    /**
     * 可配置变量的默认值
     */
    variable_defaults: Record<string, string>;
    /**
     * 模板内容版本号
     */
    version: number;
    /**
     * 是否为默认提示词
     */
    is_default: boolean;
    /**
     * 是否为系统预置
     */
    is_system: boolean;
    /**
     * 创建时间
     */
    created_at: string;
    /**
     * 最后更新时间
     */
    updated_at: string;
};

