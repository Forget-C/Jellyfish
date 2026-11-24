/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * Use a named character image as an explicit video subject.
 */
export type VideoCharacterUse = {
    kind: 'use_video_character';
    position?: number;
    before_segment_id?: (string | null);
    source_card: string;
    target_card: string;
    subject_name: string;
};
