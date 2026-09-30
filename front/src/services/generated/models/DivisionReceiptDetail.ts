/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChapterSequences } from './ChapterSequences';
/**
 * 未接入的旧回执仅供核对；资料不完整时保留原因而不拼造快照。
 */
export type DivisionReceiptDetail = {
    request_id: string;
    chapter: (ChapterSequences | null);
    issues: Array<string>;
};
