/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 问题定位固定剪辑中的采用身份，不按共享 Take 推断唯一片段。
 */
export type SceneCutIssue = {
    id: string;
    severity: 'required' | 'optional' | 'postproduction';
    observation: string;
    acceptance: string;
    clip_ids?: Array<string>;
};
