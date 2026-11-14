/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 当前演员图片的历史生成参数；只投影已保存的公开字段。
 */
export type ActorImageParametersRead = {
    task_id: string;
    created_at_ts: number;
    model_name?: (string | null);
    view_angle?: (string | null);
    reference_count?: (number | null);
    execution_prompt?: (string | null);
    parameters?: Record<string, string>;
};

