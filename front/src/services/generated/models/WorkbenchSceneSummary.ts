/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { WorkbenchTaskSummary } from './WorkbenchTaskSummary';
/**
 * 场次的共同画布与准备计数，区别于旧版导演生产计数。
 */
export type WorkbenchSceneSummary = {
    id: string;
    position: number;
    title: string;
    source_excerpt: string;
    source_changed: boolean;
    object_count: number;
    canvas_count: number;
    has_object_preparation: boolean;
    preparation_stale: boolean;
    object_task: (WorkbenchTaskSummary | null);
    storyboard_task: (WorkbenchTaskSummary | null);
};
