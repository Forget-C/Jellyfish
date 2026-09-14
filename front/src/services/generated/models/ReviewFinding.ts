/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Note_Output } from './Note_Output';
/**
 * 岗位观察、修改建议和验收保持可追溯。
 */
export type ReviewFinding = {
    observation: string;
    affected_paths: Array<string>;
    suggestion: Note_Output;
    acceptance: Note_Output;
};

