/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApiResponse_CanvasRead_ } from '../models/ApiResponse_CanvasRead_';
import type { ApiResponse_CanvasSaved_ } from '../models/ApiResponse_CanvasSaved_';
import type { ApiResponse_list_CanvasRead__ } from '../models/ApiResponse_list_CanvasRead__';
import type { ApiResponse_NoneType_ } from '../models/ApiResponse_NoneType_';
import type { CanvasCreate } from '../models/CanvasCreate';
import type { CanvasSave } from '../models/CanvasSave';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StudioGenerationCanvasesService {
    /**
     * List Canvases
     * 列出项目画布。
     * @returns ApiResponse_list_CanvasRead__ Successful Response
     * @throws ApiError
     */
    public static canvasList({
        projectId,
    }: {
        projectId: string,
    }): CancelablePromise<ApiResponse_list_CanvasRead__> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{project_id}',
            path: {
                'project_id': projectId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Create Canvas
     * 创建空画布。
     * @returns ApiResponse_CanvasRead_ Successful Response
     * @throws ApiError
     */
    public static canvasCreate({
        projectId,
        requestBody,
    }: {
        projectId: string,
        requestBody: CanvasCreate,
    }): CancelablePromise<ApiResponse_CanvasRead_> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/v1/studio/generation-canvases/{project_id}',
            path: {
                'project_id': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Get Canvas
     * 读取当前文档。
     * @returns ApiResponse_CanvasRead_ Successful Response
     * @throws ApiError
     */
    public static canvasGet({
        projectId,
        canvasId,
    }: {
        projectId: string,
        canvasId: string,
    }): CancelablePromise<ApiResponse_CanvasRead_> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}',
            path: {
                'project_id': projectId,
                'canvas_id': canvasId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Save Canvas
     * CAS 保存完整文档并返回持久原回执。
     * @returns ApiResponse_CanvasSaved_ Successful Response
     * @throws ApiError
     */
    public static canvasSave({
        projectId,
        canvasId,
        requestBody,
    }: {
        projectId: string,
        canvasId: string,
        requestBody: CanvasSave,
    }): CancelablePromise<ApiResponse_CanvasSaved_> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}',
            path: {
                'project_id': projectId,
                'canvas_id': canvasId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                409: `Conflict`,
                422: `Unprocessable Entity`,
            },
        });
    }
    /**
     * Delete Canvas
     * 删除无运行的画布。
     * @returns ApiResponse_NoneType_ Successful Response
     * @throws ApiError
     */
    public static canvasDelete({
        projectId,
        canvasId,
    }: {
        projectId: string,
        canvasId: string,
    }): CancelablePromise<ApiResponse_NoneType_> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/v1/studio/generation-canvases/{project_id}/{canvas_id}',
            path: {
                'project_id': projectId,
                'canvas_id': canvasId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
