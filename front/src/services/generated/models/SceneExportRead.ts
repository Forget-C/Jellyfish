/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneExportSnapshot } from './SceneExportSnapshot';
/**
 * 任务成功且文件可用时才提供下载入口。
 */
export type SceneExportRead = {
    task_id: string;
    request_id: string;
    status: string;
    cancel_requested: boolean;
    retry_of_task_id: (string | null);
    error: (string | null);
    snapshot: SceneExportSnapshot;
    file_id: (string | null);
    file_status: 'none' | 'available' | 'unavailable' | 'unknown';
    file_deleted: boolean;
    download_url: (string | null);
};
