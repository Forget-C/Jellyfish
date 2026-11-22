/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantChange } from './CanvasAssistantChange';
/**
 * One selectable group of changes which share an approval decision.
 */
export type CanvasAssistantEditGroup = {
    id: string;
    title: string;
    edits: Array<CanvasAssistantChange>;
    state?: 'pending' | 'rejected' | 'applied' | 'superseded';
};
