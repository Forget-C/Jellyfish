/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasDocument } from './CanvasDocument';
/**
 * Return the canonical document if approval added cards during promotion.
 */
export type CanvasDraftSaved = {
    request_id: string;
    canvas_id: string;
    revision: number;
    document?: (CanvasDocument | null);
};
