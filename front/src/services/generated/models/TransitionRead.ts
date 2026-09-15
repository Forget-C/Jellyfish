/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TransitionWrite_Output } from './TransitionWrite_Output';
/**
 * 当前相邻场次审查及历史记录是否仍适用。
 */
export type TransitionRead = {
    id: string;
    current: boolean;
    content: TransitionWrite_Output;
};
