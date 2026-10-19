/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { UnitScopeUse_Output } from './UnitScopeUse_Output';
/**
 * 按单元出现项固定执行、约束与解释背景，不以画布归位推定拍摄范围。
 */
export type UnitScopeProjection_Output = {
    version?: number;
    execution: Array<UnitScopeUse_Output>;
    constraints: Array<UnitScopeUse_Output>;
    background: Array<UnitScopeUse_Output>;
    unresolved: Array<string>;
};
