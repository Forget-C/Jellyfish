/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { WorkbenchSceneSummary } from './WorkbenchSceneSummary';
/**
 * 当前及历史场次分别排序，不携带画布或资产文档。
 */
export type ChapterWorkbenchManagement = {
    chapter_id: string;
    title: string;
    has_source: boolean;
    sequences: Array<WorkbenchSceneSummary>;
    historical_sequences: Array<WorkbenchSceneSummary>;
};
