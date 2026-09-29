/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 整体修改的结果，不冒充某个检查问题。
 */
export type RevisionSummary = {
    status: 'planned' | 'needs_choice' | 'unresolved' | 'unchanged';
    reason: string;
    choices?: Array<string>;
};
