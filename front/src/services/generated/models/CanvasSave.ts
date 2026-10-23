/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 请求正文保持原样用于幂等核实，服务层返回带定位的结构诊断。
 */
export type CanvasSave = {
    request_id: string;
    expected_revision: number;
    document: any;
};

