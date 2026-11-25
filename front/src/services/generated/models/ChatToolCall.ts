/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * Public identity and lifecycle of a tool chosen by the main chat model.
 */
export type ChatToolCall = {
    id: string;
    name: string;
    state: 'started' | 'completed' | 'failed';
};
