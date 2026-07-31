/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { GenerationDeliveryResult } from './GenerationDeliveryResult';
import type { TaskStatus } from './TaskStatus';
export type TaskResultRead = {
    task_id: string;
    status: TaskStatus;
    progress: number;
    result?: (Record<string, any> | null);
    /**
     * 图片/视频生成任务的强类型终态交付；非生成任务或历史结果为 null
     */
    generation_delivery?: (GenerationDeliveryResult | null);
    error?: string;
    /**
     * 是否已请求取消
     */
    cancel_requested?: boolean;
    /**
     * 请求取消时间戳
     */
    cancel_requested_at_ts?: (number | null);
    /**
     * 任务开始执行时间戳
     */
    started_at_ts?: (number | null);
    /**
     * 任务结束时间戳
     */
    finished_at_ts?: (number | null);
    /**
     * 任务累计执行耗时（毫秒）
     */
    elapsed_ms?: (number | null);
};

