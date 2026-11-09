/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { StoryboardTaskSummary } from './StoryboardTaskSummary';
/**
 * 准备页的轻量入口，打开后仍走共同画布读取。
 */
export type SceneCanvasSummary = {
    id: string;
    name: string;
    source_changed: boolean;
    created_at: string;
    latest_storyboard?: (StoryboardTaskSummary | null);
    candidate_storyboard_task_id?: (string | null);
    storyboard_review_required?: boolean;
    applied_storyboard_task_id?: (string | null);
};
