/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChapterStatus } from './ChapterStatus';
import type { SourceExplanation } from './SourceExplanation';
export type ChapterUpdate = {
    expected_basis_version?: (string | null);
    project_id?: (string | null);
    index?: (number | null);
    title?: (string | null);
    summary?: (string | null);
    raw_text?: (string | null);
    source_explanations?: (Array<SourceExplanation> | null);
    condensed_text?: (string | null);
    status?: (ChapterStatus | null);
};
