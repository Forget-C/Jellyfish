/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PaginatedData_PromptTemplateSummary_ } from './PaginatedData_PromptTemplateSummary_';
export type ApiResponse_PaginatedData_PromptTemplateSummary__ = {
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
    data?: (PaginatedData_PromptTemplateSummary_ | null);
    /**
     * 附加元信息
     */
    meta?: (Record<string, any> | null);
};

