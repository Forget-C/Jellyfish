/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AddModelCard } from './AddModelCard';
import type { AddMovementCard } from './AddMovementCard';
import type { AddTextCard } from './AddTextCard';
/**
 * Retain the proposed card identity and typed initial fields for approval.
 */
export type AddCanvasCardTarget = {
    kind: 'add_canvas_card';
    card: (AddTextCard | AddModelCard | AddMovementCard);
};
