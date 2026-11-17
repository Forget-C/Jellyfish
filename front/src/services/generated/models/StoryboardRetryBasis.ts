/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { StoryboardAttemptRead } from './StoryboardAttemptRead';
import type { StoryboardBasis } from './StoryboardBasis';
import type { StoryboardDiff } from './StoryboardDiff';
import type { StoryboardStructureOption } from './StoryboardStructureOption';
import type { StoryboardUserIssue } from './StoryboardUserIssue';
/**
 * 本次重试实际可采用的依据与沿用的模型配置。
 */
export type StoryboardRetryBasis = {
    canvas_id: string;
    basis: StoryboardBasis;
    source_kind: 'fixed' | 'confirmed_scene';
    mode: 'complete' | 'faithful';
    text_model_name: string;
    production_model_id?: (string | null);
    production_model_name?: (string | null);
    pending_modality: 'image' | 'video';
    prompt_only?: boolean;
    review_only?: boolean;
    review_basis_changed?: boolean;
    review_diff?: (StoryboardDiff | null);
    structure_only?: boolean;
    structure_issues?: Array<string>;
    user_issues?: Array<StoryboardUserIssue>;
    current_attempt?: (StoryboardAttemptRead | null);
    history?: Array<StoryboardAttemptRead>;
    previous_correction_notes?: string;
    structure_options?: Array<StoryboardStructureOption>;
};
