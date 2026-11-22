/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * One stable submission and the status of its canonical run.
 */
export type CanvasAssistantGenerationVersion = {
    version: number;
    request_id: string;
    run_id: string;
    input_revision: number;
    state: string;
    error?: (string | null);
};
