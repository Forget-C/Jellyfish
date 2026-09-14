/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Source } from './Source';
import type { SourceSpan } from './SourceSpan';
/**
 * 当前场次及原文变化提示，保留最初选定文本。
 */
export type SequenceRead = {
    id: string;
    project_id: string;
    chapter_id: string;
    position: number;
    title: string;
    version: number;
    source: Source;
    span: (SourceSpan | null);
    source_text: string;
    source_changed: boolean;
};

