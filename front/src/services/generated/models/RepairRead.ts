/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RevisionSnapshot_RepairItem_ } from './RevisionSnapshot_RepairItem_';
/**
 * 返工展示服务端核算的实际变化，避免多变量伪称单变量。
 */
export type RepairRead = {
    revision: RevisionSnapshot_RepairItem_;
    current: boolean;
    changed_factors: Array<string>;
    prepared_plan_ids?: Array<string>;
};
