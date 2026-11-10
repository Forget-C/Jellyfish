/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { StoryboardBasis } from './StoryboardBasis';
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
    review_only?: boolean;
};
