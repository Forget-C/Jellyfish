/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TaskListItemRead } from './TaskListItemRead';
/**
 * 以创建时间和 ID 游标翻页，避免新任务插入造成历史页偏移。
 */
export type TaskPageRead = {
    items: Array<TaskListItemRead>;
    next_cursor?: (string | null);
};

