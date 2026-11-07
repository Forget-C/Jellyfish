/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * Public identity and visible evidence for media supplied to a check model.
 */
export type CanvasCheckMediaObservation = {
    modality: 'image' | 'video';
    file_id: string;
    description?: (string | null);
    frame_at_ms?: (number | null);
};
