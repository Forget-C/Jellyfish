/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MediaRange } from './MediaRange';
import type { Source } from './Source';
/**
 * 人为观察到的实际覆盖，毫秒区间不由预计节拍换算。
 */
export type ActualCoverage_Output = {
    id: string;
    coverage_item_id: string;
    media_range: MediaRange;
    observation: string;
    source: Source;
};
