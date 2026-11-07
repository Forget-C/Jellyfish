/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * One linked check card's planned post-generation coverage.
 */
export type CanvasAutomaticCheckEstimate = {
    check_card_id: string;
    target_card_id: string;
    product_count: number;
    observation_method: 'text' | 'image' | 'video_frame' | 'video_sequence' | 'video_mixed';
    estimated_calls: number;
    reason?: (string | null);
};
