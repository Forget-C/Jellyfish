/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 业务面板的生成历史条目，身份由任务和输出序号组成。
 */
export type TaskOutputHistoryRead = {
    ordinal: number;
    file_id: string;
    media_type: string;
    delivery_status?: (string | null);
    delivery_reason?: (string | null);
    deleted?: boolean;
    task_id: string;
    created_at_ts: number;
};
