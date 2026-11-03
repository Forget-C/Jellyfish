/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Output } from './Note_Output';
import type { ReviewOccurrence } from './ReviewOccurrence';
import type { ReviewRow } from './ReviewRow';
/**
 * 固定审稿清单，正式审稿必须保留六乘 N 行。
 */
export type ReviewPacket = {
    mode: 'consultation' | 'formal';
    roles: Array<'direction' | 'performance' | 'staging' | 'cinematography' | 'continuity' | 'prompt'>;
    occurrences: Array<ReviewOccurrence>;
    rows: Array<ReviewRow>;
    context: Note_Output;
};
