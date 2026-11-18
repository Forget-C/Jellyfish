/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { UnitScopeUse } from './UnitScopeUse';
/**
 * 按单元出现项固定执行、约束与解释背景，不以画布归位推定拍摄范围。
 */
export type UnitScopeProjection = {
    version?: number;
    execution: Array<UnitScopeUse>;
    constraints: Array<UnitScopeUse>;
    background: Array<UnitScopeUse>;
    unresolved: Array<string>;
};
