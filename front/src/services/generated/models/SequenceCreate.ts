/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SourceSpan } from './SourceSpan';
/**
 * 手动或 AI 确认范围；须含正文且不与同原文版本的其他场次相交。
 */
export type SequenceCreate = {
    title: string;
    position: number;
    source_version: string;
    span: SourceSpan;
};
