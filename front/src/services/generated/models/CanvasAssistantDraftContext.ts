/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantPoint } from './CanvasAssistantPoint';
/**
 * Current visible canvas document and the scope locked at send time.
 */
export type CanvasAssistantDraftContext = {
    /**
     * 当前可见的画布文档，遵循 CanvasDocument 契约
     */
    draft: Record<string, any>;
    revision: number;
    scope: 'selection' | 'canvas';
    card_ids?: Array<string>;
    layout_positions?: (Record<string, CanvasAssistantPoint> | null);
};
