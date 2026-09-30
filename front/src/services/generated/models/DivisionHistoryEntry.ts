/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 保存版本和未关联分析共用列表，任务状态不占正式版本号。
 */
export type DivisionHistoryEntry = {
    id: string;
    kind: 'version' | 'analysis' | 'receipt';
    number: (number | null);
    origin: string;
    created_at: string;
    sequence_count: (number | null);
    status: string;
    progress: (number | null);
    is_current: boolean;
    source_task_id: (string | null);
    save_relation?: 'saved' | 'unsaved' | 'unknown' | 'not_applicable';
};
