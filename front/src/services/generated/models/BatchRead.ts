/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BatchItemRead } from './BatchItemRead';
/**
 * 可恢复的批量受理记录，重复提交同一批不增加任务。
 */
export type BatchRead = {
    id: string;
    sequence_id: string;
    version: number;
    status: 'prepared' | 'submitted';
    created_at: string;
    items: Array<BatchItemRead>;
};
