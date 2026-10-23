/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasResolvedOutput } from './CanvasResolvedOutput';
import type { CanvasRunRead } from './CanvasRunRead';
/**
 * 一致切点及其之后的恢复游标。
 */
export type CanvasSnapshot = {
    cursor: number;
    runs: Array<CanvasRunRead>;
    current_outputs: Record<string, Array<CanvasResolvedOutput>>;
};
