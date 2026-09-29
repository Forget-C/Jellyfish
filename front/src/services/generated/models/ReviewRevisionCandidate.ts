/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RevisionDirectionOutcome } from './RevisionDirectionOutcome';
import type { RevisionFieldChange } from './RevisionFieldChange';
import type { RevisionSummary } from './RevisionSummary';
/**
 * 真实差异、可选问题回应和服务端完整预览，不提供模型自行决定的整份设计。
 */
export type ReviewRevisionCandidate = {
    input_identity: string;
    changes?: Array<RevisionFieldChange>;
    summary?: (RevisionSummary | null);
    preview_text?: (string | null);
    candidate_identity?: (string | null);
    source_prompt_revision_id?: (string | null);
    outcomes?: Array<RevisionDirectionOutcome>;
};
