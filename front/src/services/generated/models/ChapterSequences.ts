/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DivisionVersionRef } from './DivisionVersionRef';
import type { SequenceRead } from './SequenceRead';
/**
 * 章节原文与场次清单，支持刷新后恢复正确上下文。
 */
export type ChapterSequences = {
    chapter_id: string;
    title: string;
    raw_text: string;
    source_version: string;
    sequences: Array<SequenceRead>;
    task_ids?: Array<string>;
    current_version?: (DivisionVersionRef | null);
};

