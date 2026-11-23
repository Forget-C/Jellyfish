/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CanvasAssistantGenerationInput } from './CanvasAssistantGenerationInput';
/**
 * The frozen and current inputs reviewed before further versions are allowed.
 */
export type CanvasAssistantGenerationDifference = {
    before?: (CanvasAssistantGenerationInput | null);
    after: CanvasAssistantGenerationInput;
    revision: number;
    basis_hash: string;
};
