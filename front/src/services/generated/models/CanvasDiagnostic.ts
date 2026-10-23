/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 按稳定身份和字段路径定位的业务诊断。
 */
export type CanvasDiagnostic = {
    code: string;
    severity?: string;
    message: string;
    target: Record<string, any>;
    blocks: Array<string>;
};

