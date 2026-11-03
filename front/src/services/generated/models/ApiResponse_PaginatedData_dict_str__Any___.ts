/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PaginatedData_dict_str__Any__ } from './PaginatedData_dict_str__Any__';
export type ApiResponse_PaginatedData_dict_str__Any___ = {
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
    data?: (PaginatedData_dict_str__Any__ | null);
    /**
     * 附加元信息
     */
    meta?: (Record<string, any> | null);
};

