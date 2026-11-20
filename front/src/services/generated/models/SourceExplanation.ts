/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 空摘录表示全章解释；版本匹配后才可被任务采用。
 */
export type SourceExplanation = {
    policy_version?: (number | null);
    kind?: 'explanation' | 'normal';
    id: string;
    excerpt?: string;
    start?: (number | null);
    end?: (number | null);
    text: string;
    source_version: string;
};
