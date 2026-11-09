/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * Undo or redo one reviewed application through the existing document history.
 */
export type StoryboardRestore = {
    request_id: string;
    expected_revision: number;
    direction: 'undo' | 'redo';
    document: Record<string, any>;
};
