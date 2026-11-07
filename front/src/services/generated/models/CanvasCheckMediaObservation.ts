/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasCheckMediaInterval } from './CanvasCheckMediaInterval';
import type { CanvasCheckVideoMoment } from './CanvasCheckVideoMoment';
import type { CanvasCheckVideoRange } from './CanvasCheckVideoRange';
/**
 * Public identity and visible evidence for media supplied to a check model.
 */
export type CanvasCheckMediaObservation = {
    modality: 'image' | 'video';
    file_id: string;
    description?: (string | null);
    frame_at_ms?: (number | null);
    video_range?: (CanvasCheckVideoRange | null);
    evidence_range?: (CanvasCheckMediaInterval | null);
    moments?: Array<CanvasCheckVideoMoment>;
};
