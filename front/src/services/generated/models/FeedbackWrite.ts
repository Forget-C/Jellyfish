/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CutReviewDocument } from './CutReviewDocument';
import type { KnowledgeDocument } from './KnowledgeDocument';
import type { RepairDocument } from './RepairDocument';
/**
 * 复用已确认版本派生与草稿 CAS，不另设可变台账。
 */
export type FeedbackWrite = {
    document: (CutReviewDocument | RepairDocument | KnowledgeDocument);
    revision_id?: (string | null);
    expected_version?: (number | null);
    parent_id?: (string | null);
};
