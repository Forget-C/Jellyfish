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
    observation: 'image' | 'video_frame' | 'unavailable';
    at_ms?: (number | null);
};
