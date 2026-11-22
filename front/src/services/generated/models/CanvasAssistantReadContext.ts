/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * Read-only snapshot limited to the requested targets and adopted sources.
 */
export type CanvasAssistantReadContext = {
    revision: number;
    scope: 'selection' | 'canvas';
    target_card_ids: Array<string>;
    cards: Array<Record<string, any>>;
};
