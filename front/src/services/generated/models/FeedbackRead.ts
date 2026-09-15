/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RepairRead } from './RepairRead';
import type { RevisionSnapshot_CutReview_ } from './RevisionSnapshot_CutReview_';
import type { RevisionSnapshot_KnowledgeCandidate_ } from './RevisionSnapshot_KnowledgeCandidate_';
/**
 * 业务记录来自版本存储，current 由当前采用实时决定。
 */
export type FeedbackRead = {
    active_cut_revision_id: (string | null);
    current_review_id: (string | null);
    reviews: Array<RevisionSnapshot_CutReview_>;
    repairs: Array<RepairRead>;
    knowledge: Array<RevisionSnapshot_KnowledgeCandidate_>;
};
