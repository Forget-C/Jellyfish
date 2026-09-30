/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 用户指定旧身份的去向；空 targets 表示移出，多个表示拆分。
 */
export type DivisionLineage = {
    sequence_id: string;
    target_keys: Array<string>;
};
