/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SourceSpan } from './SourceSpan';
/**
 * 场次范围或标题改变时必须比较原版本。
 */
export type SequenceUpdate = {
    title: string;
    position: number;
    source_version: string;
    span: SourceSpan;
    expected_version: number;
};

