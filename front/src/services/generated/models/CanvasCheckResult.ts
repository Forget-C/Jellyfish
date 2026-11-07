/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasCheckMediaObservation } from './CanvasCheckMediaObservation';
/**
 * 结论只覆盖这一项的已观测依据。
 */
export type CanvasCheckResult = {
    item_id: string;
    outcome: 'conforming' | 'nonconforming' | 'risk' | 'indeterminate';
    message: string;
    boundary: string;
    submitted_excerpt?: (string | null);
    observed_media?: Array<CanvasCheckMediaObservation>;
};
