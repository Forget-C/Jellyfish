/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_list_PromptCategoryOptionRead__ } from '../models/ApiResponse_list_PromptCategoryOptionRead__';
import type { ApiResponse_NoneType_ } from '../models/ApiResponse_NoneType_';
import type { ApiResponse_PaginatedData_PromptTemplateRead__ } from '../models/ApiResponse_PaginatedData_PromptTemplateRead__';
import type { ApiResponse_PaginatedData_PromptTemplateSummary__ } from '../models/ApiResponse_PaginatedData_PromptTemplateSummary__';
import type { ApiResponse_PromptTemplateRead_ } from '../models/ApiResponse_PromptTemplateRead_';
import type { PromptCategory } from '../models/PromptCategory';
import type { PromptTemplateCreate } from '../models/PromptTemplateCreate';
import type { PromptTemplateUpdate } from '../models/PromptTemplateUpdate';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioPromptsService {
    /**
     * 提示词模板列表（分页）
     * @returns ApiResponse_PaginatedData_PromptTemplateRead__ Successful Response
     * @throws ApiError
     */
    public static listPromptTemplatesApiV1StudioPromptsGet({
        category,
        q,
        isDefault,
        isSystem,
        order,
        isDesc = false,
        page = 1,
        pageSize = 10,
    }: {
        /**
         * 按类别过滤
         */
        category?: (PromptCategory | null),
        /**
         * 关键字，过滤 name
         */
        q?: (string | null),
        /**
         * 过滤是否为默认
         */
        isDefault?: (boolean | null),
        /**
         * 过滤是否为系统预置
         */
        isSystem?: (boolean | null),
        order?: (string | null),
        isDesc?: boolean,
        page?: number,
        pageSize?: number,
    }): CancelablePromise<ApiResponse_PaginatedData_PromptTemplateRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/prompts',
            query: {
                'category': category,
                'q': q,
                'is_default': isDefault,
                'is_system': isSystem,
                'order': order,
                'is_desc': isDesc,
                'page': page,
                'page_size': pageSize,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 创建提示词模板
     * @returns ApiResponse_PromptTemplateRead_ Successful Response
     * @throws ApiError
     */
    public static createPromptTemplateApiV1StudioPromptsPost({
        requestBody,
    }: {
        requestBody: PromptTemplateCreate,
    }): CancelablePromise<ApiResponse_PromptTemplateRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/prompts',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 按名称或简介搜索模板摘要
     * 对名称与简介做字面包含匹配，先稳定分页再交由界面分组。
     * @returns ApiResponse_PaginatedData_PromptTemplateSummary__ Successful Response
     * @throws ApiError
     */
    public static listPromptSummariesApiV1StudioPromptsSummariesGet({
        q = '',
        page = 1,
        pageSize = 10,
    }: {
        q?: string,
        page?: number,
        pageSize?: number,
    }): CancelablePromise<ApiResponse_PaginatedData_PromptTemplateSummary__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/prompts/summaries',
            query: {
                'q': q,
                'page': page,
                'page_size': pageSize,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 获取提示词类别枚举（含中文映射）
     * @returns ApiResponse_list_PromptCategoryOptionRead__ Successful Response
     * @throws ApiError
     */
    public static listPromptCategoriesApiV1StudioPromptsCategoriesGet(): CancelablePromise<ApiResponse_list_PromptCategoryOptionRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/prompts/categories',
        });
    }
    /**
     * 获取提示词模板详情
     * @returns ApiResponse_PromptTemplateRead_ Successful Response
     * @throws ApiError
     */
    public static getPromptTemplateApiV1StudioPromptsTemplateIdGet({
        templateId,
    }: {
        templateId: string,
    }): CancelablePromise<ApiResponse_PromptTemplateRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/prompts/{template_id}',
            path: {
                'template_id': templateId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * 局部更新提示词模板
     * @returns ApiResponse_PromptTemplateRead_ Successful Response
     * @throws ApiError
     */
    public static updatePromptTemplateApiV1StudioPromptsTemplateIdPatch({
        templateId,
        requestBody,
    }: {
        templateId: string,
        requestBody: PromptTemplateUpdate,
    }): CancelablePromise<ApiResponse_PromptTemplateRead_> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/v1/studio/prompts/{template_id}',
            path: {
                'template_id': templateId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                409: `请先将同类别的其他模板设为默认`,
                422: `Validation Error`,
            },
        });
    }
    /**
     * 删除提示词模板
     * @returns ApiResponse_NoneType_ Successful Response
     * @throws ApiError
     */
    public static deletePromptTemplateApiV1StudioPromptsTemplateIdDelete({
        templateId,
    }: {
        templateId: string,
    }): CancelablePromise<ApiResponse_NoneType_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/studio/prompts/{template_id}',
            path: {
                'template_id': templateId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
