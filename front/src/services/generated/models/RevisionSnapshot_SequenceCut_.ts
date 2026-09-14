/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SequenceCut_Output } from './SequenceCut_Output';
export type RevisionSnapshot_SequenceCut_ = {
    id: string;
    project_id: string;
    chapter_id: string;
    sequence_id: string;
    parent_id: (string | null);
    version: number;
    confirmed_by: (string | null);
    confirmed_at: (string | null);
    content: SequenceCut_Output;
};

