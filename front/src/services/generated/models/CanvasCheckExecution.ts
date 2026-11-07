/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 任务状态独立于观察结论；失败不会填入业务结果。
 */
export type CanvasCheckExecution = {
    item_id: string;
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
    cancel_requested?: boolean;
    reason?: (string | null);
};
