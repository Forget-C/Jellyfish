/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAutomaticCheckEstimate } from './CanvasAutomaticCheckEstimate';
import type { CanvasCompiledInput } from './CanvasCompiledInput';
import type { CanvasDiagnostic } from './CanvasDiagnostic';
/**
 * 可展示的固定输入；秘密供应商配置不进入协议。
 */
export type CanvasPrecheck = {
    revision: number;
    card_id: string;
    execution_nodes: Array<string>;
    reused_results?: Array<string>;
    input: CanvasCompiledInput;
    model?: Record<string, any>;
    diagnostics?: Array<CanvasDiagnostic>;
    can_run: boolean;
    preview_token?: (string | null);
    automatic_checks?: Array<CanvasAutomaticCheckEstimate>;
};
