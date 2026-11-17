/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 生成前疑点，不引用尚不存在的镜头。
 */
export type ShootingIssue = {
    id: string;
    category: 'position' | 'path' | 'visibility' | 'continuity' | 'source';
    kind: 'conflict' | 'insufficient_basis' | 'optional';
    excerpt?: string;
    note_id?: (string | null);
    problem: string;
    suggestion?: string;
};
