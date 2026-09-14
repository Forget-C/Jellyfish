/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Source } from './Source';
import type { StyleRule_Output } from './StyleRule_Output';
/**
 * 一份完整项目风格快照，确认后不可原地修改。
 */
export type ProjectStyleProfile_Output = {
    title: string;
    rules: Array<StyleRule_Output>;
    sources: Array<Source>;
};
