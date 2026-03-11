/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChapterStatus } from './ChapterStatus';
export type ChapterUpdate = {
    project_id?: (string | null);
    index?: (number | null);
    title?: (string | null);
    summary?: (string | null);
    raw_text?: (string | null);
    condensed_text?: (string | null);
    storyboard_count?: (number | null);
    status?: (ChapterStatus | null);
};

