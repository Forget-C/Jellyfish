/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * An archived output can be identified after reconnecting.
 */
export type MediaArtifactRead = {
    file_id: string;
    ordinal: number;
    media_type: 'image' | 'video' | 'audio';
    deleted: boolean;
};
