/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 提交时冻结的渲染元数据；用于重现输入，不作为授权或模板真实性证明。
 */
export type AssetPromptAudit = {
    render_id: string;
    template_id?: (string | null);
    template_version?: (number | null);
    variables: Record<string, string>;
    execution_prompt: string;
    reference_file_ids: Array<string>;
};
