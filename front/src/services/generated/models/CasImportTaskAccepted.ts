/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * POST /import/async 的响应体：任务已受理。
 */
export type CasImportTaskAccepted = {
    /**
     * 任务中心任务 ID
     */
    task_id: string;
    /**
     * 任务状态（pending/running/...）
     */
    status: string;
    /**
     * 是否复用了同一剧集的活动任务
     */
    reused: boolean;
    /**
     * 任务种类（cas_import_episode_package）
     */
    task_kind: string;
    /**
     * 业务关联类型
     */
    relation_type: string;
    /**
     * 业务关联实体键（project+episode 摘要）
     */
    relation_entity_id: string;
};

