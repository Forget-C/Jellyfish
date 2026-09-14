/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TaskOutputHistoryRead } from './TaskOutputHistoryRead';
/**
 * 按任务创建顺序和输出序号翻页的媒体历史。
 */
export type TaskOutputPageRead = {
    items: Array<TaskOutputHistoryRead>;
    next_cursor?: (string | null);
};
