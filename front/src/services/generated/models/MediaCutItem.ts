/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MediaRange } from './MediaRange';
/**
 * 真实素材项显式选择 Take 和源区间。
 */
export type MediaCutItem = {
    kind: string;
    id: string;
    take_id: string;
    media_range: MediaRange;
    timeline_start_ms: number;
};
