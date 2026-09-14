/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MediaCutItem } from './MediaCutItem';
import type { PlannedCutItem } from './PlannedCutItem';
/**
 * 场次单视频轨预演或粗剪，候选 Take 不自动进入这里。
 */
export type SequenceCut_Output = {
    items: Array<(PlannedCutItem | MediaCutItem)>;
};

