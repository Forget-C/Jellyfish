/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * Insert a dynamic text reference at a selected segment or after existing text.
 */
export type VideoTextUse = {
    kind: 'use_video_text';
    source_card: string;
    target_card: string;
    before_segment_id?: (string | null);
    replace_segment_id?: (string | null);
};
