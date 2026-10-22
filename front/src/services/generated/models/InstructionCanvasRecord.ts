/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 当前相关原任务的轻量只读定位；不携带历史正文或执行授权。
 */
export type InstructionCanvasRecord = {
    task_id: string;
    version_id: string;
    unit_id: string;
    request_id: string;
    kind: 'suggestion' | 'check';
    status: string;
    bound?: boolean;
    matches_current?: (boolean | null);
    confirmed?: boolean;
    reason?: (string | null);
};
