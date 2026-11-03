/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SourceRead } from './SourceRead';
export type ApiResponse_list_SourceRead__ = {
    /**
     * 与 HTTP 状态码一致
     */
    code?: number;
    /**
     * 提示信息
     */
    message?: string;
    /**
     * 实际数据
     */
    data?: (Array<SourceRead> | null);
    /**
     * 附加元信息
     */
    meta?: (Record<string, any> | null);
};
