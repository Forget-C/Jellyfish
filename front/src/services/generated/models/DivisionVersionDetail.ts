/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChapterSequences } from './ChapterSequences';
import type { DivisionBaseline } from './DivisionBaseline';
import type { DivisionHistoryEntry } from './DivisionHistoryEntry';
/**
 * 只返回已保存的当时正文和成员，不用当前场次拼接历史。
 */
export type DivisionVersionDetail = {
    version: DivisionHistoryEntry;
    chapter: ChapterSequences;
    source_revision_id: (string | null);
    base_revision_id: (string | null);
    mapping: Record<string, any>;
    restored_baseline: Array<DivisionBaseline>;
};
