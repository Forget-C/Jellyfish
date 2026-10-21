/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Source } from './Source';
/**
 * 历史生产计划与单元身份保持固定，不按当前单元名称替代。
 */
export type CanvasPlanDependency = {
    frame_id: (string | null);
    reference_id: (string | null);
    status: 'unbound' | 'current' | 'needs_review' | 'unavailable';
    message: string;
    frame_file_id: (string | null);
    at_ms: (number | null);
    source: (Source | null);
    kind: 'plan';
    plan_revision_id: string;
    unit_id: string;
};
