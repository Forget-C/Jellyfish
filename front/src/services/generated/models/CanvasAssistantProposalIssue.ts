/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * A preview failure scoped to an original, one-based group and operation.
 */
export type CanvasAssistantProposalIssue = {
    message: string;
    group?: (number | null);
    operation?: (number | null);
    field?: (string | null);
    source_card?: (string | null);
    target_card?: (string | null);
};
