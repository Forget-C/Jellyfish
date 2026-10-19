/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { UnitScopeUse_Input } from './UnitScopeUse_Input';
/**
 * 按单元出现项固定执行、约束与解释背景，不以画布归位推定拍摄范围。
 */
export type UnitScopeProjection_Input = {
    version?: number;
    execution: Array<UnitScopeUse_Input>;
    constraints: Array<UnitScopeUse_Input>;
    background: Array<UnitScopeUse_Input>;
    unresolved: Array<string>;
};
