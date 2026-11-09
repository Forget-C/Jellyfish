/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SceneCanvasSummary } from './SceneCanvasSummary';
import type { SequenceRead } from './SequenceRead';
/**
 * 一份场次摘要及本场独立画布。
 */
export type SceneCanvasesRead = {
    sequence: SequenceRead;
    canvases: Array<SceneCanvasSummary>;
};
