/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * A selected file and the evidence actually sent for this turn.
 */
export type CanvasAssistantAttachment = {
    file_id: string;
    name?: (string | null);
    file_type?: ('image' | 'video' | null);
    observation: 'image' | 'video_frame' | 'video_sequence' | 'video_with_audio' | 'unavailable';
    at_ms?: (number | null);
    start_ms?: (number | null);
    end_ms?: (number | null);
    audio_start_ms?: (number | null);
    audio_end_ms?: (number | null);
};
