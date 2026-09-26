/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 出图任务查询结果（回读 OSS 地址）。
 */
export type ImageTaskQueryRead = {
    service_task_id: string;
    status?: string;
    oss_url?: string;
    local_path?: string;
    images?: Array<Record<string, any>>;
    error_message?: string;
    dry_run?: boolean;
};

