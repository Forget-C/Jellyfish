/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasCompiledInput } from './CanvasCompiledInput';
import type { CanvasModelCapability } from './CanvasModelCapability';
/**
 * 绑定当前模型目标的公开编译结果，排除供应商执行配置。
 */
export type CanvasCheckBasis = {
    target_card_id: string;
    revision: number;
    basis_hash: string;
    model_id: (string | null);
    parameters: Record<string, (string | number | boolean | null)>;
    capability?: (CanvasModelCapability | null);
    input: CanvasCompiledInput;
};
