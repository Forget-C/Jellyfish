/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasDiagnostic } from './CanvasDiagnostic';
/**
 * 统一 HTTP 错误封套，data 保留稳定代号、定位及阻止动作。
 */
export type CanvasError = {
    /**
     * 与 HTTP 状态码一致
     */
    code?: number;
    /**
     * 提示信息
     */
    message?: string;
    /**
     * 实际数据
     */
    data?: (CanvasDiagnostic | null);
    /**
     * 附加元信息
     */
    meta?: (Record<string, any> | null);
};

