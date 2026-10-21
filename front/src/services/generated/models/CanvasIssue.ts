/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasTarget } from './CanvasTarget';
/**
 * 共同诊断形状保留具体业务语义，不等同于生成授权。
 */
export type CanvasIssue = {
    code: string;
    message: string;
    severity: 'info' | 'warning' | 'error';
    target: CanvasTarget;
};
