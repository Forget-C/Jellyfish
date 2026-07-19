/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type RenderedPromptResponse = {
    /**
     * 渲染后的提示词（已套用模板与变量替换）
     */
    prompt: string;
    /**
     * 参考图 file_id 列表（自动选择；顺序有效）
     */
    images?: Array<string>;
    /**
     * 本次渲染使用的模板 ID；未命中模板时为空
     */
    template_id?: (string | null);
    /**
     * 本次渲染使用的模板版本号
     */
    template_version?: (number | null);
    /**
     * 模板默认值、业务事实与图片覆盖合并后的变量
     */
    merged_variables?: Record<string, string>;
};

