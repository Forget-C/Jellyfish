/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DivisionBaseline } from './DivisionBaseline';
import type { DivisionHistoryEntry } from './DivisionHistoryEntry';
import type { DivisionResult } from './DivisionResult';
import type { DivisionVersionRef } from './DivisionVersionRef';
/**
 * 只返回业务所需冻结输入；缺失或损坏的历史资料明确列出。
 */
export type DivisionAnalysisDetail = {
    analysis: DivisionHistoryEntry;
    raw_text: (string | null);
    source_version: (string | null);
    baseline: (Array<DivisionBaseline> | null);
    result: (DivisionResult | null);
    source_changed: boolean;
    baseline_changed: boolean;
    issues: Array<string>;
    saved_versions: Array<DivisionVersionRef>;
};
