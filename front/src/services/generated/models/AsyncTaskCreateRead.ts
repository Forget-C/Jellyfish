/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TaskStatus } from './TaskStatus';
export type AsyncTaskCreateRead = {
    /**
     * 任务 ID
     */
    task_id: string;
    /**
     * 任务状态
     */
    status: TaskStatus;
    /**
     * 是否复用了当前业务实体已有的活跃任务
     */
    reused?: boolean;
    /**
     * 业务关联类型
     */
    relation_type?: (string | null);
    /**
     * 业务关联实体 ID
     */
    relation_entity_id?: (string | null);
};

