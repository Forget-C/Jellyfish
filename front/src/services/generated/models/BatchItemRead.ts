/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 展示固定范围和当前通用任务状态；预检错误不伪装成已创建的失败任务。
 */
export type BatchItemRead = {
    prompt_revision_id: string;
    review_revision_id: string;
    ordinal: number;
    plan_revision_id: string;
    unit_id: string;
    model_id: string;
    duration_ms: number;
    ratio: string;
    task_id?: (string | null);
    status: 'ready' | 'blocked' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
    error?: (string | null);
};
