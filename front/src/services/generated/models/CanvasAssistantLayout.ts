/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ArrangeCanvasCards } from './ArrangeCanvasCards';
import type { CanvasAssistantGrouping } from './CanvasAssistantGrouping';
import type { CanvasAssistantPoint } from './CanvasAssistantPoint';
import type { MoveCanvasCards } from './MoveCanvasCards';
/**
 * A proposal reserves no document edit or layout until the editor applies it.
 */
export type CanvasAssistantLayout = {
    state?: 'proposed' | 'waiting' | 'applied' | 'stale' | 'rejected';
    before: Record<string, CanvasAssistantPoint>;
    group_membership: Record<string, (string | null)>;
    placement?: ((MoveCanvasCards | ArrangeCanvasCards) | null);
    group?: (CanvasAssistantGrouping | null);
};
