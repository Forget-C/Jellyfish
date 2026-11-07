/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasCheckBasis } from './CanvasCheckBasis';
import type { CanvasCheckExecution } from './CanvasCheckExecution';
import type { CanvasCheckItem } from './CanvasCheckItem';
import type { CanvasCheckOmission } from './CanvasCheckOmission';
import type { CanvasCheckResult } from './CanvasCheckResult';
/**
 * 固定本轮目标、依据、所选项目与结果；重查形成新身份。
 */
export type CanvasCheckReportRead = {
    id: string;
    check_card_id: string;
    created_at: string;
    scope: 'all' | 'item';
    basis: CanvasCheckBasis;
    items: Array<CanvasCheckItem>;
    results: Array<CanvasCheckResult>;
    omitted?: Array<CanvasCheckOmission>;
    check_model_id?: (string | null);
    executions?: Array<CanvasCheckExecution>;
    /**
     * 执行时启用的项目；可与本轮实际执行范围不同。
     */
    enabled_item_ids?: (Array<string> | null);
};
