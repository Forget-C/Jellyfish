/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 拟落实是模型建议；必要创作选择必须明确呈现。
 */
export type RevisionDirectionOutcome = {
    problem_key: string;
    status: 'planned' | 'needs_choice' | 'unresolved';
    reason: string;
    choices?: Array<string>;
};
