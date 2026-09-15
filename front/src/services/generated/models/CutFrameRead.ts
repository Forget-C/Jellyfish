/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MediaRange } from './MediaRange';
/**
 * 不可变提帧来源及其相对当前采用版本的有效性。
 */
export type CutFrameRead = {
    id: string;
    cut_revision_id: string;
    item_id: string;
    take_id: string;
    plan_revision_id: string;
    unit_id: string;
    file_id: string;
    media_range: MediaRange;
    at_ms: number;
    edge: 'start' | 'end';
    current: boolean;
};
