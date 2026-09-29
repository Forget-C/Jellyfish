/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 只替换服务端列出的已有字段，before 必须等于固定输入。
 */
export type RevisionFieldChange = {
    target: 'design' | 'unit';
    path: string;
    before: any;
    after: any;
    reason: string;
    problem_keys?: Array<string>;
};
