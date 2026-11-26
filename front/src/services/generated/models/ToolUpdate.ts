/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ToolUpdate = {
    tool_call_id: string;
    tool: string;
    state: 'started' | 'completed' | 'failed';
    parameters: Record<string, any>;
    model_id: (string | null);
    error: (string | null);
};
