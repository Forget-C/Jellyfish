/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChapterSequences } from './ChapterSequences';
import type { DivisionImpact } from './DivisionImpact';
/**
 * 提交时的完整快照和新建映射；恢复响应不重复创建或再次更新。
 */
export type DivisionSaved = {
    request_id: string;
    chapter: ChapterSequences;
    created_sequence_ids: Record<string, any>;
    impacts: Array<DivisionImpact>;
};
