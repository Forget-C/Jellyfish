/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 重复请求只核实首次提交，不重新读取时间线。
 */
export type SceneExportRequest = {
    request_id: string;
    expected_revision: number;
    size?: 1080 | 720;
};
