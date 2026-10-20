/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 缺项定位到原对象与字段；可保存不代表设计或拍摄准备完整。
 */
export type DesignScopeIssue = {
    owner: string;
    field: string;
    path: Array<(string | number)>;
    reason: string;
    shot_ids?: Array<string>;
};
