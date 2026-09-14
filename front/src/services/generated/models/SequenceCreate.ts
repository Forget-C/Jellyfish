/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SourceSpan } from './SourceSpan';
/**
 * 手动建场次或确认 AI 划场结果，共用当前原文版本。
 */
export type SequenceCreate = {
    title: string;
    position: number;
    source_version: string;
    span: SourceSpan;
};

