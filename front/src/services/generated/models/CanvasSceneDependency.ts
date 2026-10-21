/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Source } from './Source';
/**
 * 场次版本单次采用与落幅身份，不重新绑定到最新采用。
 */
export type CanvasSceneDependency = {
    frame_id: (string | null);
    reference_id: (string | null);
    status: 'unbound' | 'current' | 'needs_review' | 'unavailable';
    message: string;
    frame_file_id: (string | null);
    at_ms: (number | null);
    source: (Source | null);
    kind: 'scene';
    version_id: string;
    clip_id: string;
};
