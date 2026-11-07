/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasCheckResult } from './CanvasCheckResult';
/**
 * Original finding and the lead used exclusively in this recheck.
 */
export type CanvasCheckRecheck = {
    report_id: string;
    clarification: string;
    original_result: CanvasCheckResult;
};
