/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { StoryboardPlanReview } from './StoryboardPlanReview';
import type { StoryboardTargetedRepair } from './StoryboardTargetedRepair';
/**
 * 使用失败任务的原配置，在同一目标上提交新的文本任务。
 */
export type StoryboardRetry = {
    request_id: string;
    basis_token?: (string | null);
    use_saved_objects?: boolean;
    regenerate?: boolean;
    structure_choice_id?: (string | null);
    targeted_repair?: (StoryboardTargetedRepair | null);
    review_plan?: (StoryboardPlanReview | null);
};
