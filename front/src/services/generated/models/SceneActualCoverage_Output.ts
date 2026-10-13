/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MediaRange } from './MediaRange';
import type { Source } from './Source';
/**
 * 覆盖定位当前方案单元与出现项，不借用原生产计划的动作身份。
 */
export type SceneActualCoverage_Output = {
    id: string;
    coverage_item_id: string;
    media_range: MediaRange;
    observation: string;
    source: Source;
    unit_id: string;
};
