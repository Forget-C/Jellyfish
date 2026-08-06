/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TaskStatus } from './TaskStatus';
export type TaskListItemRead = {
    task_id: string;
    /**
     * 业务任务类型
     */
    task_kind: string;
    status: TaskStatus;
    progress: number;
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
    /**
     * 任务创建时间戳
     */
    created_at_ts?: (number | null);
    /**
     * 任务更新时间戳
     */
    updated_at_ts?: (number | null);
    /**
     * 最近一次投递的执行器类型，仅用于诊断，如 celery
     */
    executor_type?: (string | null);
    /**
     * 最近一次执行器 work ID，仅用于诊断，不作为执行真相
     */
    executor_task_id?: (string | null);
    /**
     * 业务关联类型
     */
    relation_type?: (string | null);
    /**
     * 业务关联实体 ID
     */
    relation_entity_id?: (string | null);
    /**
     * 资源类型
     */
    resource_type?: (string | null);
    /**
     * 前端默认跳转关联类型
     */
    navigate_relation_type?: (string | null);
    /**
     * 前端默认跳转关联实体 ID
     */
    navigate_relation_entity_id?: (string | null);
};

