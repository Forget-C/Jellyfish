/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 局部更新提示词模板。不含 id / is_system。
 */
export type PromptTemplateUpdate = {
    /**
     * 模板名称
     */
    name?: (string | null);
    /**
     * 模板内容
     */
    content?: (string | null);
    /**
     * 预览文案
     */
    preview?: (string | null);
    /**
     * 变量名列表（整体替换）
     */
    variables?: (Array<string> | null);
    /**
     * 可配置变量的默认值（整体替换）
     */
    variable_defaults?: (Record<string, string> | null);
    /**
     * 是否为默认提示词
     */
    is_default?: (boolean | null);
};

