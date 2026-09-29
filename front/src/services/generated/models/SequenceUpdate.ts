/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SourceSpan } from './SourceSpan';
/**
 * 比较原版本；省略或置空 span 仅更新名称/顺序，保留原文依据及待核对状态。
 */
export type SequenceUpdate = {
    title: string;
    position: number;
    source_version: string;
    span?: (SourceSpan | null);
    expected_version: number;
};

