/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasDiagnostic } from './CanvasDiagnostic';
import type { CanvasResolvedOutput } from './CanvasResolvedOutput';
/**
 * 单次展开与实际使用映射，媒体位置为实际提交子集内的序号。
 */
export type CanvasCompiledInput = {
    card_id: string;
    revision?: (number | null);
    text?: string;
    used?: Array<CanvasResolvedOutput>;
    media?: Array<CanvasResolvedOutput>;
    mapping?: Array<Record<string, any>>;
    diagnostics?: Array<CanvasDiagnostic>;
    can_run?: boolean;
};
