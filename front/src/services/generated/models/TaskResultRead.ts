/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { GenerationDeliveryResult } from './GenerationDeliveryResult';
import type { TaskOutputRead } from './TaskOutputRead';
import type { TaskStatus } from './TaskStatus';
/**
 * 业务面板按需查询结果，媒体结果由输出关系生成，不复制到任务 JSON。
 */
export type TaskResultRead = {
    task_id: string;
    status: TaskStatus;
    stage: string;
    progress?: (number | null);
    cancel_requested?: boolean;
    remote_cancellation?: ('requested' | 'unsupported' | 'accepted' | 'confirmed' | 'rejected' | 'unconfirmed' | null);
    cancel_requested_at_ts?: (number | null);
    started_at_ts?: (number | null);
    finished_at_ts?: (number | null);
    elapsed_ms?: (number | null);
    result?: (Record<string, any> | null);
    outputs?: Array<TaskOutputRead>;
    generation_delivery?: (GenerationDeliveryResult | null);
    error?: string;
    error_code?: (string | null);
};
