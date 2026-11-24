/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VideoCharacterUse } from './VideoCharacterUse';
import type { VideoTextUse } from './VideoTextUse';
/**
 * Freeze the source, generated identities and previewed media for approval.
 */
export type VideoInputTarget = {
    kind: 'adopt_video_input';
    adds_edge: boolean;
    use: (VideoTextUse | VideoCharacterUse);
    identity: string;
    file_id?: (string | null);
};
